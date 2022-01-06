import { asCommitRefs } from './lib/Commits';
import type { AckCommitsEvent, CommitBody } from './types';

export type CommitValidation<EditMetadata, Delta> = {
  newCommits: readonly CommitBody<EditMetadata, Delta>[];
  invalidRefs: Set<string>;
  referencedCommits: Set<string>;
};

export function validateCommitOrder<EditMetadata, Delta>(
  commits: readonly CommitBody<EditMetadata, Delta>[],
): CommitValidation<EditMetadata, Delta> {
  const newCommitRefs = new Set<string>();
  const newCommits: CommitBody<EditMetadata, Delta>[] = [];
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
      const { baseRef, mergeRef, mergeBaseRef } = asCommitRefs(commit);
      addReferencedCommit(baseRef);
      addReferencedCommit(mergeRef);
      addReferencedCommit(mergeBaseRef);
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
