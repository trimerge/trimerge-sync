import {Commit, isMergeCommit} from '../types';

export type CommitRefs = {
    ref: string;
    baseRef?: string,
    mergeRef?: string,
    mergeBaseRef?: string,
}

// used for getting any possible refs from a general commit, refs that do not apply will be undefined.
export function refs(commit: Commit<unknown, unknown>): CommitRefs {
  const refs: CommitRefs = {
        ref: commit.ref,
        baseRef: commit.baseRef,
  }
  if (isMergeCommit(commit)) {
         refs.mergeRef = commit.mergeRef;
         refs.mergeBaseRef = commit.mergeBaseRef;
  }
  return refs;
}