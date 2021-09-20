import type { AckCommitsEvent, Commit } from './types';

export type CommitValidation<EditMetadata, Delta> = {
  newCommits: readonly Commit<EditMetadata, Delta>[];
  invalidRefs: Set<string>;
  referencedCommits: Set<string>;
};

export function validateCommitOrder<EditMetadata, Delta>(
  commits: readonly Commit<EditMetadata, Delta>[],
): CommitValidation<EditMetadata, Delta> {
  const newCommitRefs = new Set<string>();
  const newCommits: Commit<EditMetadata, Delta>[] = [];
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
      addReferencedCommit(commit.baseRef);
      addReferencedCommit(commit.mergeRef);
      addReferencedCommit(commit.mergeBaseRef);
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
