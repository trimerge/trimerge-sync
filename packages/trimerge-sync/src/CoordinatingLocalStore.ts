import {
  ClientInfo,
  ClientPresenceRef,
  Commit,
  CommitRepository,
  ErrorCode,
  GetRemoteFn,
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
import { PromiseQueue } from './lib/PromiseQueue';
import { BroadcastEvent, EventChannel } from './lib/EventChannel';
import { PrefixLogger } from './lib/PrefixLogger';

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
  onStoreEvent: OnStoreEventFn<CommitMetadata, Delta, Presence>;
  commitRepo: CommitRepository<CommitMetadata, Delta, Presence>;

  getRemote?: GetRemoteFn<CommitMetadata, Delta, Presence>;

  networkSettings?: Partial<NetworkSettings>;

  localChannel: EventChannel<CommitMetadata, Delta, Presence>;
};

export class CoordinatingLocalStore<CommitMetadata, Delta, Presence>
  implements LocalStore<CommitMetadata, Delta, Presence>
{
  private closed = false;
  private presence: ClientPresenceRef<Presence> = {
    ref: undefined,
    presence: undefined,
  };
  private remote: Remote<CommitMetadata, Delta, Presence> | undefined;
  private reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelayMs: number;
  private remoteSyncState: RemoteStateEvent = {
    type: 'remote-state',
    save: 'ready',
    connect: 'offline',
    read: 'loading',
  };
  private readonly unacknowledgedRefs = new Set<string>();
  private readonly localQueue = new PromiseQueue();
  private readonly remoteQueue = new PromiseQueue();
  private readonly onStoreEvent: OnStoreEventFn<
    CommitMetadata,
    Delta,
    Presence
  >;
  private readonly getRemote:
    | GetRemoteFn<CommitMetadata, Delta, Presence>
    | undefined;
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

  constructor(
    private readonly userId: string,
    private readonly clientId: string,
    private readonly localStoreId: string,
    {
      onStoreEvent,
      commitRepo,
      getRemote,
      networkSettings = {},
      localChannel,
    }: CoordinatingLocalStoreOptions<CommitMetadata, Delta, Presence>,
  ) {
    this.onStoreEvent = onStoreEvent;
    this.commitRepo = commitRepo;
    this.commitRepo.configureLogger(this.logger);
    this.getRemote = getRemote
      ? async (...args) => {
          const remote = await getRemote(...args);
          remote.configureLogger(this.logger);
          return remote;
        }
      : undefined;
    this.networkSettings = { ...DEFAULT_SETTINGS, ...networkSettings };
    this.reconnectDelayMs = this.networkSettings.initialDelayMs;
    this.localChannel = localChannel;
    this.localChannel.onEvent(
      (ev: BroadcastEvent<CommitMetadata, Delta, Presence>) =>
        this.onLocalBroadcastEvent(ev),
    );
    this.initialize().catch(this.handleAsError('internal'));
  }

  configureLogger(logger: Logger | undefined): void {
    if (logger) {
      this.logger = new PrefixLogger('COORDINATING_LOCAL_STORE', logger);
    } else {
      this.logger = undefined;
    }
    this.remote?.configureLogger(logger);
    this.commitRepo.configureLogger(logger);
  }

  public get isRemoteLeader(): boolean {
    return !!this.remote;
  }

  private get clientInfo(): ClientInfo<Presence> {
    const { userId, clientId } = this;
    return { userId, clientId, ...this.presence };
  }

  private async setRemoteState(update: RemoteStateEvent): Promise<void> {
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
    await this.sendEvent(update, { local: true, self: true });
  }

  protected processEvent = async (
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    // Three sources of events: local broadcast, remote broadcast, and remote via local broadcast
    origin: 'local' | 'remote' | 'remote-via-local',
  ): Promise<void> => {
    this.logger?.debug('processEvent', event, origin);
    if (event.type === 'leader') {
      if (!this.leaderManager) {
        throw new Error('got leader event with no manager');
      }
      this.leaderManager.receiveEvent(event);
      await this.sendRemoteStatus();
      return;
    }

    // Re-broadcast event to other channels
    const remoteOrigin = origin === 'remote' || origin === 'remote-via-local';
    await this.sendEvent(
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
        await this.setRemoteState({ type: 'remote-state', read: 'ready' });
        break;

      case 'commits':
        if (origin === 'remote') {
          if (event.syncId) {
            await this.setRemoteState({
              type: 'remote-state',
              cursor: event.syncId,
            });
          }
          await this.commitRepo.addCommits(event.commits, event.syncId);
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
            await this.setRemoteState({ type: 'remote-state', save: 'error' });
          } else if (this.unacknowledgedRefs.size === 0) {
            await this.setRemoteState({ type: 'remote-state', save: 'ready' });
          }
        }
        break;

      case 'client-join':
        await this.sendEvent(
          {
            type: 'client-presence',
            info: this.clientInfo,
          },
          { local: true, remote: true },
        );
        if (origin === 'local' && this.remote) {
          await this.sendEvent(this.remoteSyncState, { local: true });
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
            await this.sendEvent(
              {
                type: 'client-join',
                info: this.clientInfo,
              },
              { local: true, remote: true },
            );
          }
          await this.setRemoteState(event);
        } else {
          await this.sendRemoteStatus();
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

  private async sendRemoteStatus() {
    if (this.remote) {
      await this.sendEvent(this.remoteSyncState, { local: true, self: true });
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
    if (this.closed) {
      return;
    }

    this.closed = true;

    const { userId, clientId } = this;
    try {
      await this.sendEvent(
        {
          type: 'client-leave',
          userId,
          clientId,
        },
        { local: true, remote: true },
      );
    } catch (error) {
      this.logger?.warn('ignoring error while shutting down', error);
    }

    await this.closeRemote();

    try {
      this.leaderManager?.shutdown();
    } catch (error) {
      this.logger?.warn('ignoring error while shutting down', error);
    }

    await this.commitRepo.shutdown();
  }

  private closeRemote(reconnect: boolean = false): Promise<void> {
    const p = this.remoteQueue
      .add(async () => {
        const remote = this.remote;
        if (!remote) {
          return;
        }
        this.remote = undefined;
        await remote.shutdown();

        // If read was error when shutting down we leave it as error
        // otherwise we set it to offline.
        await this.setRemoteState({
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
        this.clearReconnectTimeout();
        const remoteSyncInfo = await this.commitRepo.getRemoteSyncInfo();
        if (this.closed || !this.getRemote) {
          await this.setRemoteState({
            type: 'remote-state',
            connect: 'offline',
            read: this.remoteSyncState.read === 'error' ? 'error' : 'offline',
            cursor: remoteSyncInfo.lastSyncCursor,
          });
          return;
        }
        await this.setRemoteState({
          type: 'remote-state',
          connect: 'connecting',
          cursor: remoteSyncInfo.lastSyncCursor,
        });
        this.remote = await this.getRemote(
          this.userId,
          this.localStoreId,
          remoteSyncInfo,
          (event) => {
            this.remoteQueue
              .add(() => this.processEvent(event, 'remote'))
              .catch(this.handleAsError('internal'));
          },
        );
        let saving = false;
        for await (const event of this.commitRepo.getCommitsForRemote()) {
          for (const { ref } of event.commits) {
            this.unacknowledgedRefs.add(ref);
          }
          if (!saving) {
            await this.setRemoteState({
              type: 'remote-state',
              save: 'saving',
            });
            saving = true;
          }
          await this.sendEvent(event, { remote: true });
        }
        await this.sendEvent({ type: 'ready' }, { remote: true });
      })
      .catch((e) => {
        this.logger?.warn(`[TRIMERGE-SYNC] error connecting to remote`, e);
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
      ).catch((e) => {
        this.logger?.warn(`error ending error message: ${e}`);
      });
      void this.shutdown();
    };
  }
  protected async sendEvent(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    {
      remote = false,
      local = false,
      self = false,
    }: { remote?: boolean; local?: boolean; self?: boolean },
    remoteOrigin: boolean = false,
  ): Promise<void> {
    this.logger?.debug('sending event', event, { remote, local, self });
    if (self) {
      try {
        this.onStoreEvent(event, remoteOrigin);
      } catch (e) {
        this.logger?.error('local error handling event', e);
        void this.shutdown();
        throw e;
      }
    }
    if (local) {
      await this.localChannel.sendEvent({ event, remoteOrigin });
    }
    if (remote && this.remote) {
      this.remote.send(event);
    }
  }

  private initialize(): Promise<void> {
    const { getRemote, networkSettings, initialized } = this;
    if (initialized) {
      throw new Error('only call initialize() once');
    }
    this.initialized = true;
    if (getRemote) {
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
      this.remoteQueue
        .add(async () => {
          await this.setRemoteState({
            type: 'remote-state',
            connect: 'offline',
            read: 'offline',
          });
        })
        .catch(this.handleAsError('internal'));
    }
    // Do only this part async
    return this.localQueue.add(async () => {
      await this.sendEvent(
        {
          type: 'client-join',
          info: this.clientInfo,
        },
        { local: true },
      );
      for await (const event of this.commitRepo.getLocalCommits()) {
        await this.sendEvent(event, { self: true });
      }
      await this.sendEvent({ type: 'ready' }, { self: true });
    });
  }
  async update(
    commits: Commit<CommitMetadata, Delta>[],
    presence: ClientPresenceRef<Presence> | undefined,
  ): Promise<void> {
    if (this.closed || (commits.length === 0 && !presence)) {
      return;
    }
    return await this.localQueue
      .add(() => this.doUpdate(commits, presence))
      .catch((e) => {
        this.handleAsError('invalid-commits')(e);
        // throw this so that the
        // error is propagated to the
        // `updateDoc` call.
        throw e;
      });
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
      await this.setRemoteState({ type: 'remote-state', save: 'pending' });
      // If we have commits, we'll send the commits and the client info together
      const ack = await this.commitRepo.addCommits(commits, undefined);
      await this.sendEvent(ack, { self: true });
      await this.setRemoteState({ type: 'remote-state', save: 'saving' });
      await this.sendEvent(
        {
          type: 'commits',
          commits,
          syncId: ack.syncId,
          clientInfo,
        },
        { local: true, remote: true },
      );
    } else if (clientInfo) {
      // If we don't have commits, we'll just send the client presence information.
      await this.sendEvent(
        { type: 'client-presence', info: clientInfo },
        { local: true, remote: true },
      );
    }
  }
}
