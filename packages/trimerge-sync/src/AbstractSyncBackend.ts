import {
  BackendEvent,
  CursorInfo,
  CursorRef,
  DiffNode,
  ErrorCode,
  GetSyncBackendFn,
  NodesEvent,
  OnEventFn,
  TrimergeSyncBackend,
} from './TrimergeSyncBackend';
import { PromiseQueue } from './lib/PromiseQueue';

export abstract class AbstractSyncBackend<EditMetadata, Delta, CursorState>
  implements TrimergeSyncBackend<EditMetadata, Delta, CursorState> {
  private closed = false;
  private cursor: CursorRef<CursorState> = { ref: undefined, state: undefined };
  private remote:
    | TrimergeSyncBackend<EditMetadata, Delta, CursorState>
    | undefined;
  private readonly remoteQueue = new PromiseQueue();

  public constructor(
    protected readonly userId: string,
    protected readonly cursorId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {}

  private getCursor(origin: 'local' | 'remote' | 'self') {
    const { userId, cursorId } = this;
    const cursor: CursorInfo<CursorState> = {
      userId,
      cursorId,
      ...this.cursor,
      origin,
    };
    return cursor;
  }

  protected onLocalBroadcastEvent = (
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): void => {
    this.onEvent(event);
    if (
      event.type === 'cursor-join' ||
      (event.type === 'remote-state' && event.connect === 'online')
    ) {
      this.sendEvent(
        {
          type: 'cursor-here',
          cursor: this.getCursor('local'),
        },
        { local: true, remote: true },
      );
    }
  };

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const { userId, cursorId } = this;
    await this.closeRemote();
    await this.sendEvent(
      {
        type: 'cursor-leave',
        userId,
        cursorId,
      },
      { local: true },
    );
  }

  private async closeRemote() {
    if (!this.remote) {
      return;
    }
    await this.remote.close();
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
    getRemoteBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    await this.remoteQueue.add(async () => {
      if (this.closed) {
        return;
      }
      console.log(`[${this.userId}:${this.cursorId}] connecting to remote`);
      await this.sendEvent(
        {
          type: 'remote-state',
          connect: 'connecting',
          read: 'loading',
        },
        { self: true, local: true },
      );
      let connected = false;
      this.remote = getRemoteBackend(
        this.userId,
        this.cursorId + '-remote-sync',
        undefined,
        (event) => {
          this.remoteQueue
            .add(async () => {
              console.log('got remote event', event);
              if (!connected) {
                connected = true;
                await this.sendEvent(
                  {
                    type: 'remote-state',
                    connect: 'online',
                  },
                  { self: true, local: true },
                );
              }
              switch (event.type) {
                case 'nodes':
                  // FIXME: add to local nodes
                  await this.sendEvent(event, { self: true, local: true });
                  break;

                case 'ack':
                  // FIXME: update local nodes with syncId
                  await this.sendEvent(event, { self: true, local: true });
                  break;

                case 'cursor-here':
                case 'cursor-join':
                case 'cursor-update':
                case 'cursor-leave':
                  await this.sendEvent(event, { self: true, local: true });
                  break;

                case 'ready':
                  await this.sendEvent(
                    {
                      type: 'remote-state',
                      read: 'ready',
                    },
                    { self: true, local: true },
                  );
                  break;
                case 'error':
                  if (event.fatal) {
                    await this.closeRemote();
                  }
                  if (event.reconnectAfter !== undefined) {
                    // TODO: reconnect after reconnectAfter seconds
                  }
                  break;

                default:
                  throw new Error(`unexpected remote event: ${event.type}`);
              }
            })
            .catch(this.handleAsError('internal'));
        },
      );
      await this.remote.broadcast({
        type: 'cursor-join',
        cursor: this.getCursor('remote'),
      });

      // FIXME: broadcast the right nodes
      await this.remote.broadcast({
        type: 'nodes',
        nodes: [],
        syncId: '',
      });
    });
  }
  protected handleAsError(code: ErrorCode) {
    return (error: Error) => {
      console.warn(`[${this.userId}:${this.cursorId}] Error:`, error);
      this.onEvent({
        type: 'error',
        code,
        message: error.message,
        fatal: true,
      });
      void this.close();
    };
  }
  protected async sendEvent(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
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
      await this.remote.broadcast(event);
    }
  }

  broadcast(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    return this.sendEvent(event, { remote: true, local: true });
  }
  /**
   * Send to all *other* local nodes
   */
  protected abstract broadcastLocal(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void>;

  protected async sendInitialEvents() {
    await this.broadcast({
      type: 'cursor-join',
      cursor: this.getCursor('local'),
    });
    for await (const event of this.getInitialNodes()) {
      this.onEvent(event);
    }
    this.onEvent({ type: 'ready' });
  }
  protected abstract getInitialNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
  >;

  update(
    newNodes: DiffNode<EditMetadata, Delta>[],
    cursor: CursorRef<CursorState> | undefined,
  ): void {
    this.doUpdate(newNodes, cursor).catch(this.handleAsError('invalid-nodes'));
  }

  protected abstract addNodes(
    nodes: DiffNode<EditMetadata, Delta>[],
  ): Promise<string>;

  private async doUpdate(
    nodes: DiffNode<EditMetadata, Delta>[],
    cursorRef: CursorRef<CursorState> | undefined,
  ): Promise<void> {
    if (cursorRef) {
      this.cursor = cursorRef;
    }

    const syncId = await this.addNodes(nodes);

    this.onEvent({
      type: 'ack',
      refs: nodes.map(({ ref }) => ref),
      syncId,
    });
    const cursor: CursorInfo<CursorState> | undefined = cursorRef && {
      ...cursorRef,
      userId: this.userId,
      cursorId: this.cursorId,
      origin: 'local',
    };
    if (nodes.length > 0) {
      await this.sendEvent(
        {
          type: 'nodes',
          nodes,
          syncId,
          cursor,
        },
        { local: true, remote: true },
      );
    } else if (cursor) {
      await this.sendEvent(
        {
          type: 'cursor-update',
          cursor,
        },
        { local: true, remote: true },
      );
    }
  }
}
