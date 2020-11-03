export type MergableNode = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
};

type Visitor<N extends MergableNode> = {
  node: N;
  current: Set<string>;
  seenRefs: Set<string>;
};

export type MergeNodeFn<N extends MergableNode> = (
  base: N | undefined,
  left: N,
  right: N,
  depth: number,
) => N;

/**
 * This function walks up the tree starting at the nodes in a breadth-first manner, merging nodes as common ancestors are found.
 *
 * Those merged nodes then continue to be merged together until there is just one head node left.
 *
 * If there are completely un-connected nodes, these will be merged with base === undefined
 */
export function mergeHeadNodes<N extends MergableNode>(
  originNodes: N[],
  getNode: (ref: string) => N,
  merge: MergeNodeFn<N>,
  sortOrder: (a: N, b: N) => number = (a, b) => (a.ref < b.ref ? -1 : 1),
): N | undefined {
  originNodes.sort(sortOrder);
  const visitors = originNodes.map(
    (node): Visitor<N> => ({
      node,
      current: new Set([node.ref]),
      seenRefs: new Set([node.ref]),
    }),
  );
  let depth = 0;

  function mergeVisitors(i: number, j: number, base?: N) {
    const a = visitors[i];
    const b = visitors[j];
    const node =
      sortOrder(a.node, b.node) <= 0
        ? merge(base, a.node, b.node, depth)
        : merge(base, b.node, a.node, depth);
    visitors[i] = {
      node,
      current: new Set([...a.current, ...b.current]),
      seenRefs: new Set([...a.seenRefs, ...b.seenRefs]),
    };
    visitors.splice(j, 1);
  }

  // Use inner function because we want to be able to break out of 3 levels of for loop
  function iterate(): boolean {
    let hasNodes = false;
    for (let i = 0; i < visitors.length; i++) {
      const leaf = visitors[i];
      const nextNodeRefs = new Set<string>();
      for (const nodeRef of leaf.current) {
        for (let j = 0; j < visitors.length; j++) {
          if (j !== i && visitors[j].seenRefs.has(nodeRef)) {
            mergeVisitors(i, j, getNode(nodeRef));
            return true;
          }
        }
        const { baseRef, baseRef2 } = getNode(nodeRef);
        if (baseRef !== undefined) {
          nextNodeRefs.add(baseRef);
          leaf.seenRefs.add(baseRef);
          hasNodes = true;
        }
        if (baseRef2 !== undefined) {
          nextNodeRefs.add(baseRef2);
          leaf.seenRefs.add(baseRef2);
          hasNodes = true;
        }
        leaf.current = nextNodeRefs;
      }
    }
    depth++;
    return hasNodes;
  }

  while (iterate());

  if (visitors.length > 1) {
    // If we still have multiple visitors, we have unconnected root nodes (undefined baseRef)
    // Sort them deterministically and merge from left to right: e.g. merge(merge(merge(0,1),2),3)
    visitors.sort((a, b) => sortOrder(a.node, b.node));
    while (visitors.length > 1) {
      mergeVisitors(0, 1);
    }
  }
  return visitors[0]?.node;
}
