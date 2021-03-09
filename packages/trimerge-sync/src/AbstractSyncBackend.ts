import {
  BackendEvent,
  CursorInfo,
  CursorJoinEvent,
  CursorRef,
  CursorUpdateEvent,
  DiffNode,
  ErrorCode,
  GetSyncBackendFn,
  NodesEvent,
  OnEventFn,
  TrimergeSyncBackend,
} from './TrimergeSyncBackend';

export abstract class AbstractSyncBackend<EditMetadata, Delta, CursorState>
  implements TrimergeSyncBackend<EditMetadata, Delta, CursorState> {
  private cursor: CursorRef<CursorState> = { ref: undefined, state: undefined };
  private remote:
    | TrimergeSyncBackend<EditMetadata, Delta, CursorState>
    | undefined;

  public constructor(
    protected readonly userId: string,
    protected readonly cursorId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {}

  private getCursorEvent(
    type: 'cursor-join' | 'cursor-update',
    origin: 'local' | 'remote' | 'self',
  ): CursorUpdateEvent<CursorState> | CursorJoinEvent<CursorState> {
    const { userId, cursorId } = this;
    return {
      type,
      userId,
      cursorId,
      ...this.cursor,
      origin,
    };
  }

  protected onBroadcastReceive(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): void {
    this.onEvent(event);
    if (event.type === 'cursor-join' || event.type === 'remote-connect') {
      this.broadcast(this.getCursorEvent('cursor-update', 'local'));
      this.remote?.broadcast(this.getCursorEvent('cursor-update', 'remote'));
    }
  }

  async close(): Promise<void> {
    const { userId, cursorId } = this;
    if (this.remote) {
      await this.remote.close();
      await this.broadcast({ type: 'remote-disconnect' });
      this.remote = undefined;
    }
    await this.broadcast({
      type: 'cursor-leave',
      userId,
      cursorId,
    });
  }

  protected connectRemote(
    getRemoteBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
  ): void {
    this.remote = getRemoteBackend(
      this.userId,
      this.cursorId + '-remote-sync',
      undefined,
      (event) => {
        switch (event.type) {
          case 'nodes':
            // add to local nodes
            break;
          case 'ready':
            break;
          case 'ack':
            break;
          case 'remote-connect':
          case 'remote-disconnect':
            // shouldn't happen from remote
            break;
          case 'error':
            if (event.fatal) {
              // reconnect?

              this.broadcast({ type: 'remote-disconnect' });
            }
            break;
        }
        this.broadcast(event);
      },
    );
    this.broadcast({ type: 'remote-connect' });
    this.remote.broadcast(this.getCursorEvent('cursor-join', 'remote'));
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
  abstract broadcast(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void>;

  protected async sendInitialEvents() {
    await this.broadcast(this.getCursorEvent('cursor-join', 'local'));
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
        ...cursor,
      });
    }
  }
}
