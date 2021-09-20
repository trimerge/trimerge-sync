import type { AckCommitsEvent, Commit } from './types';

export type DiffNodeValidation<EditMetadata, Delta> = {
  newNodes: readonly Commit<EditMetadata, Delta>[];
  invalidNodeRefs: Set<string>;
  referencedNodes: Set<string>;
};

export function validateDiffNodeOrder<EditMetadata, Delta>(
  nodes: readonly Commit<EditMetadata, Delta>[],
): DiffNodeValidation<EditMetadata, Delta> {
  const newNodeRefs = new Set<string>();
  const newNodes: Commit<EditMetadata, Delta>[] = [];
  const referencedNodes = new Set<string>();
  const invalidNodeRefs = new Set<string>();
  function addReferencedNode(ref?: string) {
    if (ref !== undefined && !newNodeRefs.has(ref)) {
      referencedNodes.add(ref);
    }
  }
  for (const node of nodes) {
    if (referencedNodes.has(node.ref)) {
      invalidNodeRefs.add(node.ref);
    } else {
      newNodes.push(node);
      newNodeRefs.add(node.ref);
      addReferencedNode(node.baseRef);
      addReferencedNode(node.mergeRef);
      addReferencedNode(node.mergeBaseRef);
    }
  }
  return { newNodes, invalidNodeRefs, referencedNodes };
}

export function addInvalidNodesToAckEvent(
  ack: AckCommitsEvent,
  invalidNodeRefs: Set<string>,
): AckCommitsEvent {
  if (invalidNodeRefs.size === 0) {
    return ack;
  }
  const refErrors = { ...ack.refErrors };
  for (const ref of invalidNodeRefs) {
    if (!(ref in refErrors)) {
      refErrors[ref] = { code: 'unknown-ref' };
    }
  }
  return { ...ack, refErrors };
}
