import { asCommitRefs } from './lib/Commits';
import type { AckCommitsEvent, Commit } from './types';

export type CommitValidation<CommitMetadata, Delta> = {
  newCommits: readonly Commit<CommitMetadata, Delta>[];
  invalidRefs: Set<string>;
  referencedCommits: Set<string>;
};

export function validateCommitOrder<CommitMetadata, Delta>(
  commits: readonly Commit<CommitMetadata, Delta>[],
): CommitValidation<CommitMetadata, Delta> {
  const newCommitRefs = new Set<string>();
  const newCommits: Commit<CommitMetadata, Delta>[] = [];
  const referencedCommits = new Set<string>();
  const invalidRefs = new Set<string>();
  function addReferencedCommit(ref?: string) {
    if (ref !== undefined && !newCommitRefs.has(ref)) {
      referencedCommits.add(ref);
    }
  }
  for (const commit of commits) {
    if (referencedCommits.has(commit.ref)) {
      invalidRefs.add(commit.ref);
    } else {
      newCommits.push(commit);
      newCommitRefs.add(commit.ref);
      const { baseRef, mergeRef } = asCommitRefs(commit);
      addReferencedCommit(baseRef);
      addReferencedCommit(mergeRef);
    }
  }
  return { newCommits, invalidRefs, referencedCommits };
}

export function addInvalidRefsToAckEvent(
  ack: AckCommitsEvent,
  invalidRefs: Set<string>,
): AckCommitsEvent {
  if (invalidRefs.size === 0) {
    return ack;
  }
  const refErrors = { ...ack.refErrors };
  for (const ref of invalidRefs) {
    if (!(ref in refErrors)) {
      refErrors[ref] = { code: 'unknown-ref' };
    }
  }
  return { ...ack, refErrors };
}
