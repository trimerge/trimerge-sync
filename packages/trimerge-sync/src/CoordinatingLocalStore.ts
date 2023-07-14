import {
  ClientInfo,
  ClientPresenceRef,
  Commit,
  CommitRepository,
  ErrorCode,
  LocalStore,
  Logger,
  OnStoreEventFn,
  Remote,
  RemoteStateEvent,
  SyncEvent,
} from './types';
import {
  DEFAULT_LEADER_SETTINGS,
  LeaderManager,
  LeaderSettings,
} from './lib/LeaderManager';
import { BroadcastEvent, EventChannel } from './lib/EventChannel';
import { PrefixLogger } from './lib/PrefixLogger';
import invariant from 'invariant';
import PQueue from 'p-queue';

export type NetworkSettings = Readonly<
  {
    initialDelayMs: number;
    reconnectBackoffMultiplier: number;
    maxReconnectDelayMs: number;
  } & LeaderSettings
>;

const DEFAULT_SETTINGS: NetworkSettings = {
  initialDelayMs: 1_000,
  reconnectBackoffMultiplier: 2,
  maxReconnectDelayMs: 30_000,
  ...DEFAULT_LEADER_SETTINGS,
};

export type CoordinatingLocalStoreOptions<CommitMetadata, Delta, Presence> = {
  commitRepo: CommitRepository<CommitMetadata, Delta, Presence>;

  remote?: Remote<CommitMetadata, Delta, Presence>;

  networkSettings?: Partial<NetworkSettings>;

  localChannel: EventChannel<CommitMetadata, Delta, Presence>;
};

export class CoordinatingLocalStore<CommitMetadata, Delta, Presence>
  implements LocalStore<CommitMetadata, Delta, Presence>
{
  private isShutdown = false;
  private presence: ClientPresenceRef<Presence> = {
    ref: undefined,
    presence: undefined,
  };
  private reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelayMs: number;
  private remoteSyncState: RemoteStateEvent = {
    type: 'remote-state',
    save: 'ready',
    connect: 'offline',
    read: 'loading',
  };
  private readonly unacknowledgedRefs = new Set<string>();
  private readonly localQueue = new PQueue({
    concurrency: 1,
  });
  private readonly remoteQueue = new PQueue({
    concurrency: 1,
  });
  private readonly remote: Remote<CommitMetadata, Delta, Presence> | undefined;
  private readonly commitRepo: CommitRepository<
    CommitMetadata,
    Delta,
    Presence
  >;
  private logger: Logger | undefined;
  private readonly localChannel: EventChannel<CommitMetadata, Delta, Presence>;
  private leaderManager?: LeaderManager = undefined;
  private readonly networkSettings: NetworkSettings;
  private initialized = false;
  private onStoreEvent:
    | OnStoreEventFn<CommitMetadata, Delta, Presence>
    | undefined;

  private readonly loggingPrefix: string;

  /** Any events emitted before we have a listener are buffered. */
  private clientEventBuffer:
    | {
        event: SyncEvent<CommitMetadata, Delta, Presence>;
        remoteOrigin: boolean;
      }[]
    | undefined = [];

  /** Any events emitted while we're connecting to the remote are buffered and replayed to the remote. */
  private remoteEventBuffer: SyncEvent<CommitMetadata, Delta, Presence>[] = [];

  constructor(
    private readonly userId: string,
    private readonly clientId: string,
    {
      commitRepo,
      remote,
      networkSettings = {},
      localChannel,
    }: CoordinatingLocalStoreOptions<CommitMetadata, Delta, Presence>,
  ) {
    this.commitRepo = commitRepo;
    this.remote = remote;
    this.networkSettings = { ...DEFAULT_SETTINGS, ...networkSettings };
    this.reconnectDelayMs = this.networkSettings.initialDelayMs;
    this.localChannel = localChannel;
    this.localChannel.onEvent(
      (ev: BroadcastEvent<CommitMetadata, Delta, Presence>) =>
        this.onLocalBroadcastEvent(ev),
    );
    this.initialize().catch(this.handleAsError('internal'));
    this.loggingPrefix = `COORDINATING_LOCAL_STORE:${clientId}`;
  }

  configureLogger(logger: Logger | undefined): void {
    if (logger) {
      this.logger = new PrefixLogger(this.loggingPrefix, logger);
    } else {
      this.logger = undefined;
    }
    this.remote?.configureLogger(logger);
    this.commitRepo.configureLogger(logger);
  }

  listen(cb: OnStoreEventFn<CommitMetadata, Delta, Presence>): void {
    this.logger?.debug('listen() called');
    if (this.onStoreEvent) {
      throw new Error('CoordinatingLocalStore can only have one listener');
    }
    this.onStoreEvent = cb;
    if (this.clientEventBuffer) {
      for (const { event, remoteOrigin } of this.clientEventBuffer) {
        cb(event, remoteOrigin);
      }
    }

    this.clientEventBuffer = undefined;
  }

  public get isRemoteLeader(): boolean {
    return Boolean(this.remote?.active);
  }

  private get clientInfo(): ClientInfo<Presence> {
    const { userId, clientId } = this;
    return { userId, clientId, ...this.presence };
  }

  private setRemoteState(update: RemoteStateEvent): void {
    const lastState = this.remoteSyncState;
    update = { ...lastState, ...update };
    if (
      update.read === lastState.read &&
      update.save === lastState.save &&
      update.connect === lastState.connect &&
      update.cursor === lastState.cursor
    ) {
      return;
    }
    this.remoteSyncState = update;
    this.sendEvent(update, { local: true, self: true });
  }

  protected processEvent = async (
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    // Three sources of events: local broadcast, remote broadcast, and remote via local broadcast
    origin: 'local' | 'remote' | 'remote-via-local',
  ): Promise<void> => {
    this.logger?.event?.({
      type: 'receive-event',
      sourceId: this.loggingPrefix,
      payload: {
        senderId:
          origin === 'remote' || origin === 'remote-via-local'
            ? `remote`
            : undefined,
        event,
      },
    });
    if (event.type === 'leader') {
      if (!this.leaderManager) {
        throw new Error('got leader event with no manager');
      }
      this.leaderManager.receiveEvent(event);
      this.broadcastRemoteStatus();
      return;
    }

    // Re-broadcast event to other channels
    const remoteOrigin = origin === 'remote' || origin === 'remote-via-local';
    this.sendEvent(
      event,
      {
        self: true,
        local: origin !== 'local' && origin !== 'remote-via-local',
        remote: !remoteOrigin && event.type !== 'remote-state',
      },
      remoteOrigin,
    );

    switch (event.type) {
      case 'ready':
        // Reset reconnect timeout
        this.reconnectDelayMs = this.networkSettings.initialDelayMs;
        this.setRemoteState({ type: 'remote-state', read: 'ready' });
        break;

      case 'commits':
        if (origin === 'remote') {
          if (event.syncId) {
            this.setRemoteState({
              type: 'remote-state',
              cursor: event.syncId,
            });
          }
          /**
           * If the commits haven't been acked, but we receive them from
           * the remote, we'll consider them acknowledged.
           */
          for (const ref of event.commits) {
            this.unacknowledgedRefs.delete(ref.ref);
          }
          void this.commitRepo.addCommits(event.commits, event.syncId);
        }
        break;

      case 'ack':
        if (origin === 'remote') {
          await this.commitRepo.acknowledgeRemoteCommits(
            event.acks,
            event.syncId,
          );
          for (const ref of event.acks) {
            this.unacknowledgedRefs.delete(ref.ref);
          }
          if (event.refErrors && Object.keys(event.refErrors).length > 0) {
            this.setRemoteState({ type: 'remote-state', save: 'error' });
          } else if (this.unacknowledgedRefs.size === 0) {
            this.setRemoteState({ type: 'remote-state', save: 'ready' });
          }
        }
        break;

      case 'client-join':
        this.sendEvent(
          {
            type: 'client-presence',
            info: this.clientInfo,
          },
          { local: true, remote: true },
        );
        if (origin === 'local' && this.remote?.active) {
          this.sendEvent(this.remoteSyncState, { local: true });
        }
        break;
      case 'client-presence':
        break;
      case 'client-leave':
        break;
      case 'remote-state':
        if (origin === 'remote') {
          if (
            event.connect === 'online' &&
            this.remoteSyncState.connect !== 'online'
          ) {
            this.sendEvent(
              {
                type: 'client-join',
                info: this.clientInfo,
              },
              { local: true, remote: true },
            );
          }
          this.setRemoteState(event);
        } else {
          this.broadcastRemoteStatus();
        }
        break;
      case 'error':
        if (origin === 'remote' && event.fatal) {
          // Do not await on this or we'll deadlock
          void this.closeRemote(event.reconnect !== false);
        }
        break;
    }
  };

  private broadcastRemoteStatus() {
    if (this.isRemoteLeader) {
      this.sendEvent(this.remoteSyncState, { local: true, self: true });
    }
  }

  private onLocalBroadcastEvent({
    event,
    remoteOrigin,
  }: BroadcastEvent<CommitMetadata, Delta, Presence>): void {
    this.localQueue
      .add(() =>
        this.processEvent(event, remoteOrigin ? 'remote-via-local' : 'local'),
      )
      .catch(this.handleAsError('network'));
  }

  async shutdown(): Promise<void> {
    this.logger?.debug('requested shutdown');
    invariant(!this.isShutdown, 'already shut down');
    this.isShutdown = true;

    const { userId, clientId } = this;
    this.sendEvent(
      {
        type: 'client-leave',
        userId,
        clientId,
      },
      { local: true, remote: true },
    );

    await this.closeRemote();
    await this.remote?.shutdown();
    await this.remoteQueue.onIdle();

    try {
      this.leaderManager?.shutdown();
    } catch (error) {
      this.logger?.warn('ignoring error while shutting down', error);
    }

    await this.localQueue.onIdle();

    await this.commitRepo.shutdown();
  }

  private closeRemote(reconnect: boolean = false): Promise<void> {
    const p = this.remoteQueue
      .add(async () => {
        this.logger?.info(`disconnecting from remote`);
        if (!this.remote?.active) {
          return;
        }

        await this.remote.disconnect();

        // If read was error when shutting down we leave it as error
        // otherwise we set it to offline.
        this.setRemoteState({
          type: 'remote-state',
          connect: 'offline',
          read: this.remoteSyncState.read === 'error' ? 'error' : 'offline',
        });
      })
      .catch((e) => {
        this.logger?.warn(`error closing remote`, e);
      });
    this.clearReconnectTimeout();
    if (reconnect) {
      const {
        reconnectDelayMs,
        networkSettings: { reconnectBackoffMultiplier, maxReconnectDelayMs },
      } = this;
      this.logger?.log(`reconnecting in ${reconnectDelayMs}`);
      this.reconnectTimeout = setTimeout(() => {
        this.clearReconnectTimeout();
        this.reconnectDelayMs = Math.min(
          reconnectDelayMs * reconnectBackoffMultiplier,
          maxReconnectDelayMs,
        );
        this.logger?.log(`reconnecting now...`);
        this.connectRemote();
      }, reconnectDelayMs);
    }
    return p;
  }

  private connectRemote(): void {
    this.remoteQueue
      .add(async () => {
        this.logger?.info(`connecting to remote`);
        this.clearReconnectTimeout();
        const remoteSyncInfo = await this.commitRepo.getRemoteSyncInfo();
        if (this.isShutdown || !this.remote) {
          this.setRemoteState({
            type: 'remote-state',
            connect: 'offline',
            read: this.remoteSyncState.read === 'error' ? 'error' : 'offline',
            cursor: remoteSyncInfo.lastSyncCursor,
          });
          return;
        }
        this.setRemoteState({
          type: 'remote-state',
          connect: 'connecting',
          cursor: remoteSyncInfo.lastSyncCursor,
        });
        await this.remote.connect(remoteSyncInfo);

        let saving = false;
        for await (const event of this.commitRepo.getCommitsForRemote()) {
          for (const { ref } of event.commits) {
            this.unacknowledgedRefs.add(ref);
          }
          if (!saving) {
            this.setRemoteState({
              type: 'remote-state',
              save: 'saving',
            });
            saving = true;
          }
          this.remote.send(event);
        }
        for (const event of this.remoteEventBuffer) {
          this.logger?.event?.({
            type: 'send-event',
            sourceId: this.loggingPrefix,
            payload: {
              recipientId: 'remote',
              event,
            },
          });
          this.remote.send(event);
        }
        this.remoteEventBuffer = [];
        this.remote.send({ type: 'ready' });
      })
      .catch((e) => {
        this.logger?.warn(`error connecting to remote`, e);
        void this.closeRemote(true);
      });
  }

  private clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
  }

  protected handleAsError(code: ErrorCode) {
    return (error: Error) => {
      this.logger?.warn(
        `[${this.userId}:${this.clientId}] Error (${code}):`,
        error,
      );
      this.sendEvent(
        {
          type: 'error',
          code,
          message: error.message,
          fatal: true,
        },
        { self: true },
      );
    };
  }
  protected sendEvent(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    {
      remote = false,
      local = false,
      self = false,
    }: { remote?: boolean; local?: boolean; self?: boolean },
    remoteOrigin: boolean = false,
  ): void {
    this.logger?.debug('sending event', event, { remote, local, self });
    if (self) {
      this.logger?.event?.({
        type: 'send-event',
        sourceId: this.loggingPrefix,
        payload: {
          event,
          recipientId: `TRIMERGE_CLIENT:${this.clientId}`,
        },
      });
      if (!this.onStoreEvent) {
        if (!this.clientEventBuffer) {
          throw new Error(
            'eventBuffer should not be undefined before the local store has been listened to.',
          );
        }
        this.clientEventBuffer.push({ event, remoteOrigin });
      } else {
        try {
          this.onStoreEvent(event, remoteOrigin);
        } catch (e) {
          this.logger?.error(`local error handling event`, e);
          void this.shutdown();
          throw e;
        }
      }
    }
    if (local) {
      this.logger?.event?.({
        type: 'broadcast-event',
        sourceId: this.loggingPrefix,
        payload: {
          event,
          remoteOrigin,
        },
      });
      this.localChannel.sendEvent({ event, remoteOrigin });
    }
    if (remote) {
      if (
        this.remote?.active &&
        this.remoteSyncState.connect &&
        ['online', 'connecting'].includes(this.remoteSyncState.connect)
      ) {
        if (this.remoteSyncState.connect === 'connecting') {
          this.remoteEventBuffer.push(event);
        } else {
          this.logger?.event?.({
            type: 'send-event',
            sourceId: this.loggingPrefix,
            payload: {
              recipientId: 'remote',
              event,
            },
          });
          this.remote.send(event);
        }
      } else {
        this.logger?.info(
          'got an event for remote but remote is not active',
          event,
        );
      }
    }
  }

  private initialize(): Promise<void> {
    const { remote, networkSettings, initialized } = this;
    if (initialized) {
      throw new Error('only call initialize() once');
    }
    this.initialized = true;
    if (remote) {
      // If we have a remote, we always listen but if we're not the leader, we won't connect.
      remote.listen((event) => {
        this.remoteQueue
          .add(() => this.processEvent(event, 'remote'))
          .catch(this.handleAsError('internal'));
      });
      this.leaderManager = new LeaderManager(
        this.clientId,
        (isLeader) => {
          if (isLeader) {
            this.logger?.log(`Became leader, connecting...`);
            this.connectRemote();
          } else {
            this.logger?.warn(`Demoted as leader, disconnecting...`);
            void this.closeRemote();
          }
        },
        (event) => {
          this.localChannel.sendEvent({ event, remoteOrigin: false });
        },
        networkSettings,
      );
    } else {
      this.setRemoteState({
        type: 'remote-state',
        connect: 'offline',
        read: 'offline',
      });
    }
    // Do only this part async
    return this.localQueue.add(async () => {
      this.sendEvent(
        {
          type: 'client-join',
          info: this.clientInfo,
        },
        { local: true },
      );
      for await (const event of this.commitRepo.getLocalCommits()) {
        this.sendEvent(event, { self: true });
      }
      this.sendEvent({ type: 'ready' }, { self: true });
    });
  }
  async update(
    commits: Commit<CommitMetadata, Delta>[],
    presence: ClientPresenceRef<Presence> | undefined,
  ): Promise<void> {
    invariant(!this.isShutdown, 'cannot update a closed client');

    if (commits.length === 0 && !presence) {
      return;
    }
    return await this.doUpdate(commits, presence);
  }

  private async doUpdate(
    commits: Commit<CommitMetadata, Delta>[],
    presenceRef: ClientPresenceRef<Presence> | undefined,
  ): Promise<void> {
    if (presenceRef) {
      this.presence = presenceRef;
    }

    const clientInfo: ClientInfo<Presence> | undefined = presenceRef && {
      ...presenceRef,
      userId: this.userId,
      clientId: this.clientId,
    };
    if (commits.length > 0) {
      this.setRemoteState({ type: 'remote-state', save: 'pending' });
      // If we have commits, we'll send the commits and the client info together
      this.logger?.debug('saving commits locally commits', commits);
      const ack = await this.commitRepo.addCommits(commits, undefined);
      const ackMap = new Map(ack.acks.map((c) => [c.ref, c.metadata]));
      const ackedCommits: Commit<CommitMetadata, Delta>[] = [];
      for (const commit of commits) {
        const ackedMetadata = ackMap.get(commit.ref);
        if (ackedMetadata !== undefined) {
          ackedCommits.push({ ...commit, metadata: ackedMetadata });
        }
      }
      this.sendEvent(ack, { self: true });
      this.setRemoteState({ type: 'remote-state', save: 'saving' });
      this.sendEvent(
        {
          type: 'commits',
          commits: ackedCommits,
          syncId: ack.syncId,
          clientInfo,
        },
        { local: true, remote: true },
      );
    } else if (clientInfo) {
      // If we don't have commits, we'll just send the client presence information.
      this.sendEvent(
        { type: 'client-presence', info: clientInfo },
        { local: true, remote: true },
      );
    }
  }
}
