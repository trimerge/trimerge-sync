import {
  ClientInfo,
  ClientPresenceRef,
  DiffNode,
  ErrorCode,
  GetRemoteFn,
  LocalStore,
  NodesEvent,
  OnEventFn,
  Remote,
  SyncEvent,
} from './types';
import { PromiseQueue } from './lib/PromiseQueue';

export abstract class AbstractLocalStore<EditMetadata, Delta, PresenceState>
  implements LocalStore<EditMetadata, Delta, PresenceState> {
  private closed = false;
  private presence: ClientPresenceRef<PresenceState> = {
    ref: undefined,
    state: undefined,
  };
  private remote: Remote<EditMetadata, Delta, PresenceState> | undefined;
  private readonly remoteQueue = new PromiseQueue();

  public constructor(
    protected readonly userId: string,
    protected readonly clientId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
  ) {}

  /**
   * Send to all *other* local nodes
   */
  protected abstract broadcastLocal(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
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
  ): Promise<string>;

  protected abstract acknowledgeRemoteNodes(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void>;

  protected abstract getLastRemoteSyncId(): Promise<string | undefined>;

  private get clientInfo(): ClientInfo<PresenceState> {
    const { userId, clientId } = this;
    return { userId, clientId, ...this.presence };
  }

  // Three sources of events: self, local broadcast, and remote broadcast

  protected processEvent = async (
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
    origin: 'self' | 'local' | 'remote',
  ): Promise<void> => {
    console.log(
      `processing "${event.type}" from ${origin}: ${JSON.stringify(event)}`,
    );

    await this.sendEvent(event, {
      self: origin !== 'self',
      local: origin !== 'local',
      remote: origin !== 'remote',
    });

    switch (event.type) {
      case 'ready':
        break;
      case 'nodes':
        if (origin === 'remote') {
          const syncId = await this.addNodes(event.nodes, event.syncId);
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
          // FIXME: we might have sent more stuff since this acknowledgement
          await this.sendEvent(
            { type: 'remote-state', save: 'ready' },
            { self: true, local: true },
          );
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
        break;
      case 'client-presence':
        break;
      case 'client-leave':
        break;
      case 'remote-state':
        if (event.connect === 'online') {
          await this.sendEvent(
            {
              type: 'client-join',
              info: this.clientInfo,
            },
            { local: true, remote: true },
          );
        }
        break;
      case 'error':
        if (origin === 'remote') {
          if (event.fatal) {
            await this.closeRemote();
          }
          if (event.reconnect !== false) {
            // FIXME: handle error here
            // this.connectRemote(getRemote);
          }
        }
        break;
    }
  };

  protected onLocalBroadcastEvent = (
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): void => {
    this.processEvent(event, 'local');
  };
  protected async onRemoteEvent(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
    getRemote: GetRemoteFn<EditMetadata, Delta, PresenceState>,
  ) {
    switch (event.type) {
      case 'ready':
        await this.sendEvent(
          { type: 'remote-state', read: 'ready' },
          { self: true, local: true },
        );
        break;

      case 'remote-state':
        if (event.connect) {
          await this.sendEvent(
            { type: 'remote-state', connect: event.connect },
            { self: true, local: true },
          );
        } else {
          throw new Error(`unexpected non-connect remote-state`);
        }
        break;

      default:
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        throw new Error(`unexpected remote event: ${event!.type}`);
    }
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const { userId, clientId } = this;
    await this.closeRemote();
    await this.sendEvent(
      {
        type: 'client-leave',
        userId,
        clientId,
      },
      { local: true },
    );
  }

  private async closeRemote() {
    if (!this.remote) {
      return;
    }
    await this.remote.shutdown();
    await this.sendEvent(
      {
        type: 'remote-state',
        connect: 'offline',
        read: 'offline',
      },
      { local: true, self: true },
    );
    this.remote = undefined;
  }

  protected async connectRemote(
    getRemote: GetRemoteFn<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    await this.remoteQueue.add(async () => {
      if (this.closed) {
        return;
      }
      await this.sendEvent(
        {
          type: 'remote-state',
          connect: 'connecting',
          read: 'loading',
        },
        { self: true, local: true },
      );
      this.remote = getRemote(
        this.userId,
        await this.getLastRemoteSyncId(),
        (event) => {
          this.remoteQueue
            .add(async () => {
              console.log(`got remote event`, event);
              // await this.onRemoteEvent(event, getRemote);
              await this.processEvent(event, 'remote');
            })
            .catch(this.handleAsError('internal'));
        },
      );
      let saving = false;
      for await (const event of this.getNodesForRemote()) {
        if (!saving) {
          await this.sendEvent(
            { type: 'remote-state', save: 'saving' },
            { self: true, local: true },
          );
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
  ): Promise<void> {
    if (self) {
      console.log(`handle event: ${JSON.stringify(event)}`);
      this.onEvent(event);
    }
    if (local) {
      console.log(`send local event: ${JSON.stringify(event)}`);
      await this.broadcastLocal(event);
    }
    if (remote && this.remote) {
      console.log(`send remote event: ${JSON.stringify(event)}`);
      await this.remote.send(event);
    }
  }

  protected async sendInitialEvents() {
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
      await this.sendEvent(
        { type: 'remote-state', save: 'pending' },
        { self: true, local: true },
      );
    }

    const syncId = await this.addNodes(nodes);
    await this.sendEvent(
      {
        type: 'ack',
        refs: nodes.map(({ ref }) => ref),
        syncId,
      },
      { self: true },
    );
    const clientInfo: ClientInfo<PresenceState> | undefined = presenceRef && {
      ...presenceRef,
      userId: this.userId,
      clientId: this.clientId,
    };
    if (nodes.length > 0) {
      await this.sendEvent(
        { type: 'remote-state', save: 'saving' },
        { self: true, local: true },
      );
      await this.sendEvent(
        {
          type: 'nodes',
          nodes,
          syncId,
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
