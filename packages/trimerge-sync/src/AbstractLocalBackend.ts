import {
  BackendEvent,
  CursorInfo,
  CursorRef,
  DiffNode,
  ErrorCode,
  GetRemoteBackendFn,
  LocalBackend,
  NodesEvent,
  OnEventFn,
  RemoteBackend,
} from './types';
import { PromiseQueue } from './lib/PromiseQueue';

export abstract class AbstractLocalBackend<EditMetadata, Delta, CursorState>
  implements LocalBackend<EditMetadata, Delta, CursorState> {
  private closed = false;
  private cursor: CursorRef<CursorState> = { ref: undefined, state: undefined };
  private remote: RemoteBackend<EditMetadata, Delta, CursorState> | undefined;
  private readonly remoteQueue = new PromiseQueue();

  public constructor(
    protected readonly userId: string,
    protected readonly cursorId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {}

  /**
   * Send to all *other* local nodes
   */
  protected abstract broadcastLocal(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void>;

  protected abstract getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
  >;

  protected abstract getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
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

  async shutdown(): Promise<void> {
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
    getRemoteBackend: GetRemoteBackendFn<EditMetadata, Delta, CursorState>,
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
      this.remote = getRemoteBackend(
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
                      cursor: event.cursor,
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

                case 'cursor-here':
                case 'cursor-join':
                case 'cursor-update':
                case 'cursor-leave':
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
                    this.connectRemote(getRemoteBackend);
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
        type: 'cursor-join',
        cursor: this.getCursor('remote'),
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
      console.warn(`[${this.userId}:${this.cursorId}] Error:`, error);
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
      await this.remote.send(event);
    }
  }

  protected async sendInitialEvents() {
    await this.sendEvent(
      {
        type: 'cursor-join',
        cursor: this.getCursor('local'),
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
    cursor: CursorRef<CursorState> | undefined,
  ): void {
    this.doUpdate(newNodes, cursor).catch(this.handleAsError('invalid-nodes'));
  }

  private async doUpdate(
    nodes: DiffNode<EditMetadata, Delta>[],
    cursorRef: CursorRef<CursorState> | undefined,
  ): Promise<void> {
    if (cursorRef) {
      this.cursor = cursorRef;
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
    const cursor: CursorInfo<CursorState> | undefined = cursorRef && {
      ...cursorRef,
      userId: this.userId,
      cursorId: this.cursorId,
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
