import { DiffNode } from 'trimerge-sync';

export type NodeValidation = {
  newNodes: Set<string>;
  referencedNodes: Set<string>;
};

export function validateNodeReferences(
  nodes: readonly DiffNode<unknown, unknown>[],
): NodeValidation {
  const newNodes = new Set<string>();
  const referencedNodes = new Set<string>();
  function addReferencedNode(ref?: string) {
    if (ref !== undefined && !newNodes.has(ref)) {
      referencedNodes.add(ref);
    }
  }
  for (const node of nodes) {
    if (referencedNodes.has(node.ref)) {
      throw new Error('nodes out of order');
    }
    newNodes.add(node.ref);
    addReferencedNode(node.baseRef);
    addReferencedNode(node.mergeRef);
    addReferencedNode(node.mergeBaseRef);
  }
  return { newNodes, referencedNodes };
}
