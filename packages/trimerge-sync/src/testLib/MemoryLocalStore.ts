import { AbstractLocalStore, BroadcastEvent } from '../AbstractLocalStore';
import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import {
  AckCommitsEvent,
  Commit,
  GetRemoteFn,
  CommitsEvent,
  OnStoreEventFn,
  RemoteSyncInfo,
  CommitAck,
} from '../types';
import { MemoryStore } from './MemoryStore';

export class MemoryLocalStore<
  EditMetadata,
  Delta,
  Presence,
> extends AbstractLocalStore<EditMetadata, Delta, Presence> {
  private _closed = false;
  public readonly channel: MemoryBroadcastChannel<
    BroadcastEvent<EditMetadata, Delta, Presence>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, Presence>,
    userId: string,
    clientId: string,
    onEvent: OnStoreEventFn<EditMetadata, Delta, Presence>,
    getRemote?: GetRemoteFn<EditMetadata, Delta, Presence>,
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

  protected addCommits(
    commits: Commit<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<AckCommitsEvent> {
    return this.store.addCommits(commits, remoteSyncId);
  }

  protected async acknowledgeRemoteCommits(
    refs: readonly CommitAck[],
    remoteSyncId: string,
  ): Promise<void> {
    await this.store.acknowledgeCommits(refs, remoteSyncId);
  }

  protected async broadcastLocal(
    event: BroadcastEvent<EditMetadata, Delta, Presence>,
  ): Promise<void> {
    if (this._closed) {
      return;
    }
    await this.channel.postMessage(event);
  }

  protected async *getLocalCommits(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, Presence>
  > {
    yield await this.store.getLocalCommitsEvent();
  }

  protected getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, Presence>
  > {
    return this.store.getCommitsForRemote();
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
