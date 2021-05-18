import {
  SyncEvent,
  ClientInfo,
  ClientPresenceRef,
  DiffNode,
  ErrorCode,
  GetRemoteFn,
  LocalStore,
  NodesEvent,
  OnEventFn,
  Remote,
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

  private getClientInfo(
    origin: 'local' | 'remote' | 'self',
  ): ClientInfo<PresenceState> {
    const { userId, clientId } = this;
    return {
      userId,
      clientId,
      ...this.presence,
      origin,
    };
  }

  protected onLocalBroadcastEvent = (
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): void => {
    this.onEvent(event);
    this.remote?.send(event);
    if (
      event.type === 'client-join' ||
      (event.type === 'remote-state' && event.connect === 'online')
    ) {
      this.sendEvent(
        {
          type: 'client-presence',
          info: this.getClientInfo('local'),
        },
        { local: true, remote: true },
      );
    }
  };

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
              switch (event.type) {
                case 'nodes':
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
                  break;

                case 'ack':
                  await this.acknowledgeRemoteNodes(event.refs, event.syncId);
                  // FIXME: we might have sent more stuff since this acknowledgement
                  await this.sendEvent(
                    { type: 'remote-state', save: 'ready' },
                    { self: true, local: true },
                  );
                  break;

                case 'client-join':
                case 'client-presence':
                case 'client-leave':
                  await this.sendEvent(event, { self: true, local: true });
                  break;

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

                case 'error':
                  if (event.fatal) {
                    await this.closeRemote();
                  }
                  if (event.reconnect !== false) {
                    // FIXME: handle error here
                    this.connectRemote(getRemote);
                  }
                  break;

                default:
                  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                  throw new Error(`unexpected remote event: ${event!.type}`);
              }
            })
            .catch(this.handleAsError('internal'));
        },
      );
      await this.remote.send({
        type: 'client-join',
        info: this.getClientInfo('remote'),
      });

      let saving = false;
      for await (const event of this.getNodesForRemote()) {
        if (!saving) {
          await this.sendEvent(
            { type: 'remote-state', save: 'saving' },
            { self: true, local: true },
          );
          saving = true;
        }
        await this.remote.send(event);
      }
      await this.remote.send({ type: 'ready' });
    });
  }

  protected handleAsError(code: ErrorCode) {
    return (error: Error) => {
      console.warn(`[${this.userId}:${this.clientId}] Error:`, error);
      this.onEvent({
        type: 'error',
        code,
        message: error.message,
        fatal: true,
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
  ): Promise<void> {
    if (self) {
      this.onEvent(event);
    }
    if (local) {
      await this.broadcastLocal(event);
    }
    if (remote && this.remote) {
      await this.remote.send(event);
    }
  }

  protected async sendInitialEvents() {
    await this.sendEvent(
      {
        type: 'client-join',
        info: this.getClientInfo('local'),
      },
      { local: true },
    );
    for await (const event of this.getLocalNodes()) {
      this.onEvent(event);
    }
    this.onEvent({ type: 'ready' });
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
    this.onEvent({
      type: 'ack',
      refs: nodes.map(({ ref }) => ref),
      syncId,
    });
    const clientInfo: ClientInfo<PresenceState> | undefined = presenceRef && {
      ...presenceRef,
      userId: this.userId,
      clientId: this.clientId,
      origin: 'local',
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
