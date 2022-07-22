import {
  ClientInfo,
  ClientPresenceRef,
  Commit,
  CommitRepository,
  ErrorCode,
  GetRemoteFn,
  LocalStore,
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
import { DeltaCodec } from './DeltaCodec';

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

export class CoordinatingLocalStore<
  CommitMetadata,
  Delta,
  Presence,
  SerializedDelta,
> implements LocalStore<CommitMetadata, Delta, Presence>
{
  private closed = false;
  private presence: ClientPresenceRef<Presence> = {
    ref: undefined,
    presence: undefined,
  };
  private remote: Remote<CommitMetadata, SerializedDelta, Presence> | undefined;
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
  private leaderManager?: LeaderManager = undefined;
  private readonly networkSettings: NetworkSettings;
  private initialized = false;

  constructor(
    protected readonly userId: string,
    protected readonly clientId: string,
    // These are the events that are consumed by the TrimergeClient
    private readonly emit: OnStoreEventFn<CommitMetadata, Delta, Presence>,
    private readonly commitRepo: CommitRepository<
      CommitMetadata,
      SerializedDelta,
      Presence
    >,
    private readonly deltaCodec: DeltaCodec<Delta, SerializedDelta>,
    private readonly getRemote?: GetRemoteFn<
      CommitMetadata,
      SerializedDelta,
      Presence
    >,
    networkSettings: Partial<NetworkSettings> = {},
    private localChannel?: EventChannel<
      CommitMetadata,
      SerializedDelta,
      Presence
    >,
  ) {
    this.networkSettings = { ...DEFAULT_SETTINGS, ...networkSettings };
    this.reconnectDelayMs = this.networkSettings.initialDelayMs;
    localChannel?.onEvent(
      (ev: BroadcastEvent<CommitMetadata, SerializedDelta, Presence>) =>
        this.onLocalBroadcastEvent(ev),
    );
    this.initialize().catch(this.handleAsError('internal'));
  }

  public get isRemoteLeader(): boolean {
    return !!this.remote;
  }

  private get clientInfo(): ClientInfo<Presence> {
    const { userId, clientId } = this;
    return { userId, clientId, ...this.presence };
  }

  private serializeCommit(
    commit: Commit<CommitMetadata, Delta>,
  ): Commit<CommitMetadata, SerializedDelta> {
    return {
      ...commit,
      delta: this.deltaCodec.encode(commit.delta),
    };
  }

  private deserializeCommit(
    commit: Commit<CommitMetadata, SerializedDelta>,
  ): Commit<CommitMetadata, Delta> {
    return {
      ...commit,
      delta: this.deltaCodec.decode(commit.delta),
    };
  }

  private async setRemoteState(update: RemoteStateEvent): Promise<void> {
    const lastState = this.remoteSyncState;
    update = { ...lastState, ...update };
    if (
      update.read === lastState.read &&
      update.save === lastState.save &&
      update.connect === lastState.connect
    ) {
      return;
    }
    this.remoteSyncState = update;
    await this.sendEvent(update, { local: true, self: true });
  }

  protected processEvent = async (
    event: SyncEvent<CommitMetadata, SerializedDelta, Presence>,
    // Three sources of events: local broadcast, remote broadcast, and remote via local broadcast
    origin: 'local' | 'remote' | 'remote-via-local',
  ): Promise<void> => {
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
  }: BroadcastEvent<CommitMetadata, SerializedDelta, Presence>): void {
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
      console.warn('ignoring error while shutting down', error);
    }

    await this.closeRemote();

    try {
      this.leaderManager?.shutdown();
    } catch (error) {
      console.warn('ignoring error while shutting down', error);
    }

    this.commitRepo.shutdown();
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
        console.warn(`[TRIMERGE-SYNC] error closing remote`, e);
      });
    this.clearReconnectTimeout();
    if (reconnect) {
      const {
        reconnectDelayMs,
        networkSettings: { reconnectBackoffMultiplier, maxReconnectDelayMs },
      } = this;
      console.log(`[TRIMERGE-SYNC] reconnecting in ${reconnectDelayMs}`);
      this.reconnectTimeout = setTimeout(() => {
        this.clearReconnectTimeout();
        this.reconnectDelayMs = Math.min(
          reconnectDelayMs * reconnectBackoffMultiplier,
          maxReconnectDelayMs,
        );
        console.log(`[TRIMERGE-SYNC] reconnecting now...`);
        this.connectRemote();
      }, reconnectDelayMs);
    }
    return p;
  }

  private connectRemote(): void {
    this.remoteQueue
      .add(async () => {
        this.clearReconnectTimeout();
        if (this.closed || !this.getRemote) {
          await this.setRemoteState({
            type: 'remote-state',
            connect: 'offline',
            read: this.remoteSyncState.read === 'error' ? 'error' : 'offline',
          });
          return;
        }
        await this.setRemoteState({
          type: 'remote-state',
          connect: 'connecting',
        });
        const remoteSyncInfo = await this.commitRepo.getRemoteSyncInfo();
        this.remote = await this.getRemote(
          this.userId,
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
        console.warn(`[TRIMERGE-SYNC] error connecting to remote`, e);
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
      console.warn(`[${this.userId}:${this.clientId}] Error:`, error);
      this.sendEvent(
        {
          type: 'error',
          code,
          message: error.message,
          fatal: true,
        },
        { self: true },
      ).catch((e) => {
        console.warn(`error ending error message: ${e}`);
      });
      void this.shutdown();
    };
  }

  protected async sendEvent(
    event: SyncEvent<CommitMetadata, SerializedDelta, Presence>,
    {
      remote = false,
      local = false,
      self = false,
    }: { remote?: boolean; local?: boolean; self?: boolean },
    remoteOrigin: boolean = false,
  ): Promise<void> {
    if (self) {
      try {
        const clientEvent: SyncEvent<CommitMetadata, Delta, Presence> =
          event.type === 'commits'
            ? {
                ...event,
                commits: event.commits.map((c) =>
                  this.deserializeCommit(c),
                ) as Commit<CommitMetadata, Delta>[],
              }
            : event;
        this.emit(clientEvent, remoteOrigin);
      } catch (e) {
        console.error(`[TRIMERGE-SYNC] local error handling event`, e);
        void this.shutdown();
        throw e;
      }
    }
    if (local) {
      await this.localChannel?.sendEvent({ event, remoteOrigin });
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
            console.log(`[TRIMERGE-SYNC] Became leader, connecting...`);
            this.connectRemote();
          } else {
            console.warn(`[TRIMERGE-SYNC] Demoted as leader, disconnecting...`);
            void this.closeRemote();
          }
        },
        (event) => {
          this.localChannel?.sendEvent({ event, remoteOrigin: false });
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
      .catch(this.handleAsError('invalid-commits'));
  }

  private async doUpdate(
    commits: Commit<CommitMetadata, Delta>[],
    presenceRef: ClientPresenceRef<Presence> | undefined,
  ): Promise<void> {
    if (presenceRef) {
      this.presence = presenceRef;
    }
    if (commits.length > 0) {
      await this.setRemoteState({ type: 'remote-state', save: 'pending' });
    }

    const serializedCommits = commits.map((c) => this.serializeCommit(c));
    const ack = await this.commitRepo.addCommits(serializedCommits, undefined);
    await this.sendEvent(ack, { self: true });
    const clientInfo: ClientInfo<Presence> | undefined = presenceRef && {
      ...presenceRef,
      userId: this.userId,
      clientId: this.clientId,
    };
    if (commits.length > 0) {
      await this.setRemoteState({ type: 'remote-state', save: 'saving' });
      await this.sendEvent(
        {
          type: 'commits',
          commits: serializedCommits,
          syncId: ack.syncId,
          clientInfo,
        },
        { local: true, remote: true },
      );
    } else if (clientInfo) {
      await this.sendEvent(
        { type: 'client-presence', info: clientInfo },
        { local: true, remote: true },
      );
    }
  }
}
