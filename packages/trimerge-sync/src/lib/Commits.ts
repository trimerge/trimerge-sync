import { Commit } from '../types';

export type CommitRefs = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
};

// used for getting any possible refs from a general commit, refs that do not apply will be undefined.
export const asCommitRefs = (commit: Commit<unknown, unknown>): CommitRefs =>
  commit;
