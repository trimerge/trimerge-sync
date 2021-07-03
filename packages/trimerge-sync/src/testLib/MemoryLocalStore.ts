import { AbstractLocalStore } from '../AbstractLocalStore';
import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import {
  AckNodesEvent,
  DiffNode,
  GetRemoteFn,
  NodesEvent,
  OnEventFn,
  SyncEvent,
} from '../types';
import { MemoryStore } from './MemoryStore';

export class MemoryLocalStore<
  EditMetadata,
  Delta,
  PresenceState
> extends AbstractLocalStore<EditMetadata, Delta, PresenceState> {
  private readonly channel: MemoryBroadcastChannel<
    SyncEvent<EditMetadata, Delta, PresenceState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, PresenceState>,
    userId: string,
    clientId: string,
    onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    getRemote?: GetRemoteFn<EditMetadata, Delta, PresenceState>,
  ) {
    super(userId, clientId, onEvent, getRemote, {
      initialDelayMs: 0,
      reconnectBackoffMultiplier: 1,
      maxReconnectDelayMs: 0,
    });
    this.channel = new MemoryBroadcastChannel(
      this.store.docId,
      this.onLocalBroadcastEvent,
    );
    this.initialize().catch(this.handleAsError('internal'));
  }

  protected addNodes(
    nodes: DiffNode<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<AckNodesEvent> {
    return this.store.addNodes(nodes, remoteSyncId);
  }

  protected async acknowledgeRemoteNodes(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void> {
    await this.store.acknowledgeNodes(refs, remoteSyncId);
  }

  protected async broadcastLocal(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    await this.channel.postMessage(event);
  }

  protected async *getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    yield await this.store.getLocalNodesEvent();
  }

  protected async *getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    yield await this.store.getNodesEventForRemote();
  }

  protected getLastRemoteSyncId(): Promise<string | undefined> {
    return this.store.getLastRemoteSyncId();
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.channel.close();
  }
}
