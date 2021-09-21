import type { AckCommitsEvent, Commit, CommitsEvent } from 'trimerge-sync';

type PromiseOrValue<T> = Promise<T> | T;

export interface DocStore {
  getCommitsEvent(
    lastSyncId?: string,
  ): PromiseOrValue<CommitsEvent<unknown, unknown, unknown>>;

  add(
    commits: readonly Commit<unknown, unknown>[],
  ): PromiseOrValue<AckCommitsEvent>;

  close(): void;
}
