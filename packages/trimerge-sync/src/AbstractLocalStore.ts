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
  SyncEvent,
} from './types';
import { PromiseQueue } from './lib/PromiseQueue';
import { timeoutPromise } from './lib/timeoutPromise';
import { LeaderManagement } from './lib/LeaderManagement';

export type ReconnectSettings = Readonly<{
  initialDelayMs: number;
  reconnectBackoffMultiplier: number;
  maxReconnectDelayMs: number;
}>;

const DEFAULT_SETTINGS: ReconnectSettings = {
  initialDelayMs: 1_000,
  reconnectBackoffMultiplier: 2,
  maxReconnectDelayMs: 30_000,
};

export abstract class AbstractLocalStore<EditMetadata, Delta, PresenceState>
  implements LocalStore<EditMetadata, Delta, PresenceState> {
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
  private leaderManagement?: LeaderManagement = undefined;

  public constructor(
    protected readonly userId: string,
    protected readonly clientId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    private readonly getRemote?: GetRemoteFn<
      EditMetadata,
      Delta,
      PresenceState
    >,
    private readonly reconnectSettings: ReconnectSettings = DEFAULT_SETTINGS,
  ) {
    this.reconnectDelayMs = reconnectSettings.initialDelayMs;
  }

  /**
   * Send to all *other* local nodes
   */
  protected abstract broadcastLocal(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
    remoteOrigin: boolean,
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

  protected abstract getLastRemoteSyncId(): Promise<string | undefined>;

  private get clientInfo(): ClientInfo<PresenceState> {
    const { userId, clientId } = this;
    return { userId, clientId, ...this.presence };
  }

  private async setRemoteState(
    update: RemoteStateEvent,
    sendEvent: boolean = true,
  ): Promise<void> {
    this.remoteSyncState = { ...this.remoteSyncState, ...update };
    if (sendEvent) {
      await this.sendEvent(update, { local: true, self: true });
    }
  }

  protected processEvent = async (
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
    // Three sources of events: self, local broadcast, and remote broadcast
    origin: 'self' | 'local' | 'remote' | 'remote-via-local',
  ): Promise<void> => {
    if (process.env.NODE_ENV === 'development') {
      console.log(
        `processing "${event.type}" from ${origin}: ${JSON.stringify(event)}`,
      );
    }

    if (event.type === 'leader') {
      this.leaderManagement?.receiveEvent(event);
      return;
    }

    // Re-broadcast event to other channels
    await this.sendEvent(
      event,
      {
        self: origin !== 'self',
        local: origin !== 'local' && origin !== 'remote-via-local',
        remote: origin !== 'remote' && origin !== 'remote-via-local',
      },
      origin === 'remote',
    );

    switch (event.type) {
      case 'ready':
        // Reset reconnect timeout
        this.reconnectDelayMs = this.reconnectSettings.initialDelayMs;
        await this.setRemoteState({ type: 'remote-state', read: 'ready' });
        break;

      case 'nodes':
        if (origin === 'remote') {
          const { syncId } = await this.addNodes(event.nodes, event.syncId);
          await this.sendEvent(
            {
              type: 'nodes',
              nodes: event.nodes,
              clientInfo: event.clientInfo,
              syncId,
            },
            { self: true, local: true },
          );
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
        if (origin === 'remote' && event.connect === 'online') {
          await this.sendEvent(
            {
              type: 'client-join',
              info: this.clientInfo,
            },
            { local: true, remote: true },
          );
        }
        await this.setRemoteState(event, false);
        break;
      case 'error':
        if (origin === 'remote') {
          if (event.fatal) {
            await this.closeRemote();
          }
          if (event.reconnect !== false && this.getRemote) {
            await timeoutPromise(this.reconnectDelayMs);
            this.reconnectDelayMs = Math.min(
              this.reconnectDelayMs *
                this.reconnectSettings.reconnectBackoffMultiplier,
              this.reconnectSettings.maxReconnectDelayMs,
            );
            // Do not await on this or we'll deadlock
            this.connectRemote(this.getRemote).catch(
              this.handleAsError('network'),
            );
          }
        }
        break;
    }
  };

  protected readonly onLocalBroadcastEvent = (
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
    remoteOrigin: boolean = false,
  ): void => {
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
        { local: true },
      );
      await this.closeRemote();
    } catch (error) {
      console.warn('ignoring error while shutting down', error);
    }
  }

  private async closeRemote() {
    if (!this.remote) {
      return;
    }
    await this.remote.shutdown();
    await this.setRemoteState({
      type: 'remote-state',
      connect: 'offline',
      read: 'offline',
    });
    this.remote = undefined;
  }

  private async connectRemote(
    getRemote: GetRemoteFn<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    await this.remoteQueue.add(async () => {
      if (this.closed) {
        return;
      }
      await this.setRemoteState({
        type: 'remote-state',
        connect: 'connecting',
        read: 'loading',
      });
      this.remote = getRemote(
        this.userId,
        await this.getLastRemoteSyncId(),
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
          await this.setRemoteState({ type: 'remote-state', save: 'saving' });
          saving = true;
        }
        await this.sendEvent(event, { remote: true });
      }
      await this.sendEvent({ type: 'ready' }, { remote: true });
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
      );
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
      if (process.env.NODE_ENV === 'development') {
        console.log(`handle event: ${JSON.stringify(event)}`);
      }
      try {
        this.onEvent(event);
      } catch (e) {
        console.error(`local error handling event`, e);
        throw e;
      }
    }
    if (local) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`send local event: ${JSON.stringify(event)}`);
      }
      await this.broadcastLocal(event, remoteOrigin);
    }
    if (remote && this.remote) {
      if (process.env.NODE_ENV === 'development') {
        console.log(`send remote event: ${JSON.stringify(event)}`);
      }
      await this.remote.send(event);
    }
  }

  protected async initialize() {
    const { getRemote } = this;
    if (getRemote) {
      this.leaderManagement = new LeaderManagement(
        this.clientId,
        (leaderId) => {
          if (leaderId === this.clientId) {
            void this.connectRemote(getRemote);
          } else {
            void this.closeRemote();
          }
        },
        (event) => this.broadcastLocal(event, false),
      );
    }
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
  }
  update(
    newNodes: DiffNode<EditMetadata, Delta>[],
    presence: ClientPresenceRef<PresenceState> | undefined,
  ): void {
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
