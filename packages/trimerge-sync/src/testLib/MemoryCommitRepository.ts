import {
  AckCommitsEvent,
  Commit,
  CommitsEvent,
  RemoteSyncInfo,
  CommitAck,
  CommitRepository,
} from '../types';
import { MemoryStore } from './MemoryStore';

export class MemoryCommitRepository<CommitMetadata, Delta, Presence>
  implements CommitRepository<CommitMetadata, Delta, Presence>
{
  constructor(
    private readonly store: MemoryStore<CommitMetadata, Delta, Presence>,
  ) {}

  addCommits(
    commits: Commit<CommitMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<AckCommitsEvent<CommitMetadata>> {
    return this.store.addCommits(commits, remoteSyncId);
  }

  async acknowledgeRemoteCommits(
    refs: readonly CommitAck[],
    remoteSyncId: string,
  ): Promise<void> {
    await this.store.acknowledgeCommits(refs, remoteSyncId);
  }

  async *getLocalCommits(): AsyncIterableIterator<
    CommitsEvent<CommitMetadata, Delta, Presence>
  > {
    yield await this.store.getLocalCommitsEvent();
  }

  getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<CommitMetadata, Delta, Presence>
  > {
    return this.store.getCommitsForRemote();
  }

  getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return this.store.getRemoteSyncInfo();
  }

  async shutdown(): Promise<void> {
    // noop
  }
}
