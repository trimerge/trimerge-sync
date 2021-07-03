import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import {
  AckNodesEvent,
  DiffNode,
  ErrorCode,
  NodesEvent,
  OnEventFn,
  Remote,
  SyncEvent,
} from '../types';
import { MemoryStore } from './MemoryStore';
import { PromiseQueue } from '../lib/PromiseQueue';

export class MemoryRemote<EditMetadata, Delta, PresenceState>
  implements Remote<EditMetadata, Delta, PresenceState> {
  private readonly remoteQueue = new PromiseQueue();
  private closed = false;
  private readonly channel: MemoryBroadcastChannel<
    SyncEvent<EditMetadata, Delta, PresenceState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, PresenceState>,
    private readonly userId: string,
    lastSyncId: string | undefined,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
  ) {
    this.channel = new MemoryBroadcastChannel(this.store.docId, onEvent);
    this.sendInitialEvents(lastSyncId).catch(this.handleAsError('internal'));
  }

  private async handle(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    switch (event.type) {
      case 'nodes':
        // FIXME: check for nodes with wrong userId
        const ack = await this.addNodes(event.nodes);
        await this.onEvent(ack);
        await this.broadcast({ ...event, syncId: ack.syncId });
        break;

      case 'ready':
        // do nothing (for now)
        break;

      case 'client-join':
      case 'client-presence':
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
    this.channel.close();
  }

  fail(message: string, code: ErrorCode, reconnect = true) {
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
  protected addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
  ): Promise<AckNodesEvent> {
    return this.store.addNodes(nodes);
  }

  protected broadcast(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    return this.channel.postMessage(event);
  }

  protected async *getNodes(
    lastSyncId: string | undefined,
  ): AsyncIterableIterator<NodesEvent<EditMetadata, Delta, PresenceState>> {
    yield await this.store.getLocalNodesEvent(lastSyncId);
  }
}
