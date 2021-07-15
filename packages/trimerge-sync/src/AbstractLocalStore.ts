import {
  AckNodesEvent,
  ClientInfo,
  ClientPresenceRef,
  DiffNode,
  ErrorCode,
  GetRemoteFn,
  LocalStore,
  NodesEvent,
  OnEventFn,
  Remote,
  RemoteStateEvent,
  RemoteSyncInfo,
  SyncEvent,
} from './types';
import { PromiseQueue } from './lib/PromiseQueue';
import {
  DEFAULT_LEADER_SETTINGS,
  LeaderManager,
  LeaderSettings,
} from './lib/LeaderManager';
import { timeout } from './lib/Timeout';

export type NetworkSettings = Readonly<
  {
    initialDelayMs: number;
    reconnectBackoffMultiplier: number;
    maxReconnectDelayMs: number;
  } & LeaderSettings
>;

export type BroadcastEvent<EditMetadata, Delta, PresenceState> = {
  event: SyncEvent<EditMetadata, Delta, PresenceState>;
  remoteOrigin: boolean;
};

const DEFAULT_SETTINGS: NetworkSettings = {
  initialDelayMs: 1_000,
  reconnectBackoffMultiplier: 2,
  maxReconnectDelayMs: 30_000,
  ...DEFAULT_LEADER_SETTINGS,
};

export abstract class AbstractLocalStore<EditMetadata, Delta, PresenceState>
  implements LocalStore<EditMetadata, Delta, PresenceState>
{
  private closed = false;
  private presence: ClientPresenceRef<PresenceState> = {
    ref: undefined,
    state: undefined,
  };
  private remote: Remote<EditMetadata, Delta, PresenceState> | undefined;
  private reconnectDelayMs: number;
  private remoteSyncState: RemoteStateEvent = {
    type: 'remote-state',
    save: 'ready',
    connect: 'offline',
    read: 'offline',
  };
  private readonly unacknowledgedRefs = new Set<string>();
  private readonly remoteQueue = new PromiseQueue();
  private leaderManager?: LeaderManager = undefined;
  private readonly networkSettings: NetworkSettings;
  private initialized = false;

  protected constructor(
    protected readonly userId: string,
    protected readonly clientId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    private readonly getRemote?: GetRemoteFn<
      EditMetadata,
      Delta,
      PresenceState
    >,
    networkSettings: Partial<NetworkSettings> = {},
  ) {
    this.networkSettings = { ...DEFAULT_SETTINGS, ...networkSettings };
    this.reconnectDelayMs = this.networkSettings.initialDelayMs;
  }

  public get isRemoteLeader(): boolean {
    return !!this.remote;
  }

  /**
   * Send to all *other* local nodes
   */
  protected abstract broadcastLocal(
    event: BroadcastEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void>;

  protected abstract getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  >;

  protected abstract getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  >;

  protected abstract addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<AckNodesEvent>;

  protected abstract acknowledgeRemoteNodes(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void>;

  protected abstract getRemoteSyncInfo(): Promise<RemoteSyncInfo>;

  private get clientInfo(): ClientInfo<PresenceState> {
    const { userId, clientId } = this;
    return { userId, clientId, ...this.presence };
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
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
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

      case 'nodes':
        if (origin === 'remote') {
          await this.addNodes(event.nodes, event.syncId);
        }
        break;

      case 'ack':
        if (origin === 'remote') {
          await this.acknowledgeRemoteNodes(event.refs, event.syncId);
          for (const ref of event.refs) {
            this.unacknowledgedRefs.delete(ref);
          }
          if (this.unacknowledgedRefs.size === 0) {
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
          if (event.connect === 'online') {
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

  protected readonly onLocalBroadcastEvent = ({
    event,
    remoteOrigin,
  }: BroadcastEvent<EditMetadata, Delta, PresenceState>): void => {
    this.processEvent(event, remoteOrigin ? 'remote-via-local' : 'local').catch(
      this.handleAsError('network'),
    );
  };

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
      this.leaderManager?.close();
    } catch (error) {
      console.warn('ignoring error while shutting down', error);
    }
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
        await this.setRemoteState({
          type: 'remote-state',
          connect: 'offline',
          read: 'offline',
        });
      })
      .catch((e) => {
        console.warn(`[TRIMERGE-SYNC] error closing remote`, e);
      });

    if (reconnect) {
      const {
        reconnectDelayMs,
        networkSettings: { reconnectBackoffMultiplier, maxReconnectDelayMs },
      } = this;
      console.log(`[TRIMERGE-SYNC] reconnecting in ${reconnectDelayMs}`);
      void timeout(reconnectDelayMs).then(() => {
        this.reconnectDelayMs = Math.min(
          reconnectDelayMs * reconnectBackoffMultiplier,
          maxReconnectDelayMs,
        );
        console.log(`[TRIMERGE-SYNC] reconnecting now...`);
        this.connectRemote();
      });
    }
    return p;
  }

  private connectRemote(): void {
    this.remoteQueue
      .add(async () => {
        if (this.closed || !this.getRemote) {
          return;
        }
        await this.setRemoteState({
          type: 'remote-state',
          connect: 'connecting',
          read: 'loading',
        });
        const remoteSyncInfo = await this.getRemoteSyncInfo();
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
        for await (const event of this.getNodesForRemote()) {
          for (const { ref } of event.nodes) {
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
        console.warn(`error ending error message`);
      });
      void this.shutdown();
    };
  }
  protected async sendEvent(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
    {
      remote = false,
      local = false,
      self = false,
    }: { remote?: boolean; local?: boolean; self?: boolean },
    remoteOrigin: boolean = false,
  ): Promise<void> {
    if (self) {
      try {
        this.onEvent(event);
      } catch (e) {
        console.error(`[TRIMERGE-SYNC] local error handling event`, e);
        void this.shutdown();
        throw e;
      }
    }
    if (local) {
      await this.broadcastLocal({ event, remoteOrigin });
    }
    if (remote && this.remote) {
      await this.remote.send(event);
    }
  }

  protected initialize(): Promise<void> {
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
          this.broadcastLocal({ event, remoteOrigin: false }).catch(
            this.handleAsError('internal'),
          );
        },
        networkSettings,
      );
    }
    // Do only this part async
    return (async () => {
      await this.sendEvent(
        {
          type: 'client-join',
          info: this.clientInfo,
        },
        { local: true },
      );
      for await (const event of this.getLocalNodes()) {
        await this.sendEvent(event, { self: true });
      }
      await this.sendEvent({ type: 'ready' }, { self: true });
    })();
  }
  update(
    newNodes: DiffNode<EditMetadata, Delta>[],
    presence: ClientPresenceRef<PresenceState> | undefined,
  ): void {
    if (this.closed) {
      return;
    }
    this.doUpdate(newNodes, presence).catch(
      this.handleAsError('invalid-nodes'),
    );
  }

  private async doUpdate(
    nodes: DiffNode<EditMetadata, Delta>[],
    presenceRef: ClientPresenceRef<PresenceState> | undefined,
  ): Promise<void> {
    if (presenceRef) {
      this.presence = presenceRef;
    }
    if (nodes.length > 0) {
      await this.setRemoteState({ type: 'remote-state', save: 'pending' });
    }

    const ack = await this.addNodes(nodes);
    await this.sendEvent(ack, { self: true });
    const clientInfo: ClientInfo<PresenceState> | undefined = presenceRef && {
      ...presenceRef,
      userId: this.userId,
      clientId: this.clientId,
    };
    if (nodes.length > 0) {
      await this.setRemoteState({ type: 'remote-state', save: 'saving' });
      await this.sendEvent(
        {
          type: 'nodes',
          nodes,
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
