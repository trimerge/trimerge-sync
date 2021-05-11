import {
  AckNodesEvent,
  SyncEvent,
  ClientInfo,
  ClientPresenceRef,
  DiffNode,
  ErrorCode,
  GetLocalStoreFn,
  NodesEvent,
  OnEventFn,
  LocalStore,
  GetRemoteFn,
  Remote,
} from './types';
import { PromiseQueue } from './lib/PromiseQueue';

export abstract class AbstractRemote<EditMetadata, Delta, PresenceState>
  implements Remote<EditMetadata, Delta, PresenceState> {
  private readonly remoteQueue = new PromiseQueue();
  private closed = false;

  public constructor(
    private readonly userId: string,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
  ) {}

  protected abstract broadcast(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void>;

  protected abstract addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
  ): Promise<string>;

  protected abstract getNodes(
    lastSyncId: string | undefined,
  ): AsyncIterableIterator<NodesEvent<EditMetadata, Delta, PresenceState>>;

  private async handle(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
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

      case 'client-join':
      case 'client-presence':
        await this.broadcast({
          ...event,
          info: { ...event.info, origin: 'remote' },
        });
        break;
      case 'client-leave':
        await this.broadcast(event);
        break;

      case 'ack':
      case 'remote-state':
      case 'error':
        // Should never get these from a client
        break;
    }
  }

  send(event: SyncEvent<EditMetadata, Delta, PresenceState>): void {
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
    this.onEvent({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }

  protected fail(message: string, code: ErrorCode, reconnect = true) {
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
