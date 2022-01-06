import {
  AckCommitsEvent,
  GetLocalStoreFn,
  GetRemoteFn,
  CommitsEvent,
  RemoteSyncInfo,
  CommitAck,
  Commit,
  FlatCommit,
} from '../types';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';
import { MemoryLocalStore } from './MemoryLocalStore';
import { MemoryRemote } from './MemoryRemote';

function getSyncCounter(syncCursor: string): number {
  return parseInt(syncCursor, 36);
}

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, Presence, CreationMetadata> {
  public readonly remotes: MemoryRemote<
    EditMetadata,
    Delta,
    Presence,
    CreationMetadata
  >[] = [];
  private commits: Commit<EditMetadata, Delta, CreationMetadata>[] = [];
  private localCommitRefs = new Set<string>();
  private syncedCommits = new Set<string>();
  private readonly localStoreId = randomId();
  private lastRemoteSyncCursor: string | undefined;
  private queue = new PromiseQueue();
  private readonly localStores: MemoryLocalStore<
    EditMetadata,
    Delta,
    Presence,
    CreationMetadata
  >[] = [];

  public writeErrorMode = false;

  constructor(
    public readonly channelName: string = randomId(),
    private readonly getRemoteFn?: GetRemoteFn<
      EditMetadata,
      Delta,
      Presence,
      CreationMetadata
    >,
    public online = true,
  ) {}

  public getCommits(): readonly Commit<
    EditMetadata,
    Delta,
    CreationMetadata
  >[] {
    return this.commits;
  }

  private get syncCursor(): string {
    return this.commits.length.toString(36);
  }

  public set localNetworkPaused(paused: boolean) {
    for (const local of this.localStores) {
      local.channel.paused = paused;
    }
  }

  getLocalStore: GetLocalStoreFn<
    EditMetadata,
    Delta,
    Presence,
    CreationMetadata
  > = (userId, clientId, onEvent) => {
    const store = new MemoryLocalStore(
      this,
      userId,
      clientId,
      onEvent,
      this.getRemoteFn,
    );
    this.localStores.push(store);
    return store;
  };

  getRemote: GetRemoteFn<EditMetadata, Delta, Presence, CreationMetadata> = (
    userId: string,
    remoteSyncInfo,
    onEvent,
  ) => {
    if (!this.online) {
      throw new Error('offline');
    }
    const be = new MemoryRemote(this, userId, remoteSyncInfo, onEvent);
    this.remotes.push(be);
    return be;
  };

  addCommits(
    commits: readonly Commit<EditMetadata, Delta, CreationMetadata>[],
  ): Promise<AckCommitsEvent> {
    return this.queue.add(async () => {
      const refs = new Set<string>();
      for (const commit of commits) {
        const {
          body: { ref },
        } = commit;
        if (!this.localCommitRefs.has(ref)) {
          this.commits.push(commit);
          this.localCommitRefs.add(ref);
        }
        refs.add(ref);
      }
      for (const {
        body: { ref },
        ackMetadata,
      } of commits as FlatCommit<EditMetadata, Delta, CreationMetadata>[]) {
        if (ackMetadata) {
          this.syncedCommits.add(ref);

          // assumes these commits are in order.
          this.lastRemoteSyncCursor = ackMetadata.cursor;
        }
      }
      return {
        type: 'ack',
        acks: Array.from(refs, (ref) => ({ ref })),
        syncId: this.syncCursor,
      };
    });
  }
  async acknowledgeCommits(
    acks: readonly CommitAck[],
    remoteSyncId: string,
  ): Promise<void> {
    return this.queue.add(async () => {
      for (const ack of acks) {
        this.syncedCommits.add(ack.ref);
      }
      this.lastRemoteSyncCursor = remoteSyncId;
    });
  }

  getLocalCommitsEvent(
    startSyncCursor?: string,
  ): Promise<CommitsEvent<EditMetadata, Delta, Presence, CreationMetadata>> {
    return this.queue.add(async () => ({
      type: 'commits',
      commits:
        startSyncCursor !== undefined
          ? this.commits.slice(getSyncCounter(startSyncCursor))
          : this.commits,
      syncId: this.syncCursor,
    }));
  }
  getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return this.queue.add(async () => ({
      localStoreId: this.localStoreId,
      lastSyncCursor: this.lastRemoteSyncCursor,
    }));
  }

  async *getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, Presence, CreationMetadata>
  > {
    const commits = await this.queue.add(async () =>
      this.commits.filter(({ body: { ref } }) => !this.syncedCommits.has(ref)),
    );
    const BATCH_SIZE = 5;
    for (let i = 0; i < commits.length; i += BATCH_SIZE) {
      yield {
        type: 'commits',
        commits: commits.slice(i, i + BATCH_SIZE),
      };
    }
  }

  async shutdown(): Promise<void> {
    return await this.queue.add(async () => {
      for (const remote of this.remotes) {
        await remote.shutdown();
      }
      for (const local of this.localStores) {
        await local.shutdown();
      }
    });
  }
}
