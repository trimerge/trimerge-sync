import { AbstractLocalStore, BroadcastEvent } from '../AbstractLocalStore';
import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import {
  AckNodesEvent,
  DiffNode,
  GetRemoteFn,
  NodesEvent,
  OnEventFn,
  RemoteSyncInfo,
} from '../types';
import { MemoryStore } from './MemoryStore';

export class MemoryLocalStore<
  EditMetadata,
  Delta,
  PresenceState,
> extends AbstractLocalStore<EditMetadata, Delta, PresenceState> {
  private _closed = false;
  public readonly channel: MemoryBroadcastChannel<
    BroadcastEvent<EditMetadata, Delta, PresenceState>
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
      electionTimeoutMs: 0,
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 50,
    });
    this.channel = new MemoryBroadcastChannel(
      'local:' + this.store.channelName,
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
    event: BroadcastEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    if (this._closed) {
      return;
    }
    await this.channel.postMessage(event);
  }

  protected async *getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    yield await this.store.getLocalNodesEvent();
  }

  protected getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    return this.store.getNodesForRemote();
  }

  protected getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return this.store.getRemoteSyncInfo();
  }

  async shutdown(): Promise<void> {
    if (this._closed) {
      return;
    }
    await super.shutdown();
    // Must be after super.shutdown() because it needs to call broadcastLocal()
    this._closed = true;
    this.channel.close();
  }
}
