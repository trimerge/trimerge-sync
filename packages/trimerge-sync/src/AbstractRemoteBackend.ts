import {
  AckNodesEvent,
  BackendEvent,
  CursorInfo,
  CursorRef,
  DiffNode,
  ErrorCode,
  GetLocalBackendFn,
  NodesEvent,
  OnEventFn,
  LocalBackend,
  GetRemoteBackendFn,
  RemoteBackend,
} from './types';
import { PromiseQueue } from './lib/PromiseQueue';

export abstract class AbstractRemoteBackend<EditMetadata, Delta, CursorState>
  implements RemoteBackend<EditMetadata, Delta, CursorState> {
  private readonly remoteQueue = new PromiseQueue();
  private closed = false;

  public constructor(
    private readonly userId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {}

  protected abstract broadcast(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void>;

  protected abstract addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
  ): Promise<string>;

  protected abstract getNodes(
    lastSyncId: string | undefined,
  ): AsyncIterableIterator<NodesEvent<EditMetadata, Delta, CursorState>>;

  private async handle(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    switch (event.type) {
      case 'nodes':
        // FIXME: check for nodes with wrong userId
        const syncId = await this.addNodes(event.nodes);
        await this.onEvent({
          type: 'ack',
          refs: event.nodes.map(({ ref }) => ref),
          syncId,
        });
        await this.broadcast({ ...event, syncId });
        break;

      case 'ready':
        // do nothing (for now)
        break;

      case 'cursor-join':
      case 'cursor-here':
      case 'cursor-update':
      case 'cursor-leave':
        await this.broadcast(event);
        break;

      case 'ack':
      case 'remote-state':
      case 'error':
        // Should never get these from a client
        break;
    }
  }

  send(event: BackendEvent<EditMetadata, Delta, CursorState>): void {
    this.remoteQueue
      .add(() => this.handle(event))
      .catch(this.handleAsError('internal'));
  }

  protected async sendInitialEvents(
    lastSyncId: string | undefined,
  ): Promise<void> {
    this.onEvent({ type: 'remote-state', connect: 'connecting' });
    this.onEvent({ type: 'remote-state', connect: 'online' });

    for await (const event of this.getNodes(lastSyncId)) {
      this.onEvent(event);
    }
    this.onEvent({ type: 'ready' });
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onEvent({ type: 'remote-state', connect: 'offline' });
  }

  protected fail(
    message: string,
    code: ErrorCode = 'internal',
    reconnect = true,
  ) {
    this.onEvent({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect,
    });
    void this.shutdown();
  }

  protected handleAsError(code: ErrorCode) {
    return (error: Error) => this.fail(error.message, code);
  }
}
