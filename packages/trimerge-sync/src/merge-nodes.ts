export type MergableNode = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
};

type Visitor = {
  ref: string;
  current: Set<string>;
  seenRefs: Set<string>;
};

export type MergeNodeFn = (
  baseRef: string | undefined,
  leftRef: string,
  rightRef: string,
  depth: number,
) => string;

/**
 * This function walks up the tree starting at the nodes in a breadth-first manner, merging nodes as common ancestors are found.
 *
 * Those merged nodes then continue to be merged together until there is just one head node left.
 *
 * If there are completely un-connected nodes, these will be merged with base === undefined
 */
export function mergeHeadNodes<N extends MergableNode>(
  refs: string[],
  getNode: (ref: string) => N,
  merge: MergeNodeFn,
): string | undefined {
  refs.sort();
  const visitors = refs.map(
    (ref): Visitor => ({
      ref,
      current: new Set([ref]),
      seenRefs: new Set([ref]),
    }),
  );
  let depth = 0;

  function mergeVisitors(i: number, j: number, baseRef?: string) {
    const a = visitors[i];
    const b = visitors[j];
    const aRef = a.ref;
    const bRef = b.ref;
    const ref =
      aRef < bRef
        ? merge(baseRef, aRef, bRef, depth)
        : merge(baseRef, bRef, aRef, depth);
    visitors[i] = {
      ref,
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
            mergeVisitors(i, j, nodeRef);
            return true;
          }
        }
        const { baseRef, mergeRef } = getNode(nodeRef);
        if (baseRef !== undefined) {
          nextNodeRefs.add(baseRef);
          leaf.seenRefs.add(baseRef);
          hasNodes = true;
        }
        if (mergeRef !== undefined) {
          nextNodeRefs.add(mergeRef);
          leaf.seenRefs.add(mergeRef);
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
    visitors.sort((a, b) => (a.ref < b.ref ? -1 : 1));
    while (visitors.length > 1) {
      mergeVisitors(0, 1);
    }
  }
  return visitors[0]?.ref;
}
