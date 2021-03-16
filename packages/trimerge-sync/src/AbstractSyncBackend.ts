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

  protected onBroadcastReceive = (
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): void => {
    this.onEvent(event);
    if (
      event.type === 'cursor-join' ||
      (event.type === 'remote-state' && event.connect === 'online')
    ) {
      this.broadcast({
        type: 'cursor-here',
        cursor: this.getCursor('local'),
      });
    }
  };

  async close(): Promise<void> {
    if (this.closed) {
      throw new Error('double close');
    }
    this.closed = true;
    const { userId, cursorId } = this;
    await this.closeRemote();
    await this.broadcast({
      type: 'cursor-leave',
      userId,
      cursorId,
    });
  }

  private async closeRemote() {
    if (!this.remote) {
      return;
    }
    await this.remote.close();
    await this.broadcast({
      type: 'remote-state',
      connect: 'offline',
      read: 'offline',
    });
    this.remote = undefined;
  }

  protected async connectRemote(
    getRemoteBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    await this.remoteQueue.add(async () => {
      console.log('connecting to remote');
      await this.broadcast({
        type: 'remote-state',
        connect: 'connecting',
        read: 'loading',
      });
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
                await this.broadcast({
                  type: 'remote-state',
                  connect: 'online',
                });
              }
              switch (event.type) {
                case 'nodes':
                  // FIXME: add to local nodes
                  break;
                case 'ready':
                  await this.broadcast({
                    type: 'remote-state',
                    read: 'ready',
                  });
                  break;
                case 'ack':
                  break;
                case 'remote-state':
                  throw new Error('unexpected remote state event');
                case 'error':
                  if (event.fatal) {
                    await this.closeRemote();
                  }
                  if (event.reconnectAfter !== undefined) {
                    // TODO: reconnect after reconnectAfter seconds
                  }
                  break;
              }
              await this.broadcast(event);
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
      this.onEvent({
        type: 'error',
        code,
        message: error.message,
        fatal: true,
      });
      void this.close();
    };
  }
  async broadcast(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    await Promise.all([
      this.broadcastLocal(event),
      this.remote?.broadcast(event) || Promise.resolve(),
    ]);
  }

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
      await this.broadcast({
        type: 'nodes',
        nodes,
        syncId,
        cursor,
      });
    } else if (cursor) {
      await this.broadcast({
        type: 'cursor-update',
        cursor,
      });
    }
  }
}
