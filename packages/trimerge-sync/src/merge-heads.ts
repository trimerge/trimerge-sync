export type MergableCommit = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
};

type Visitor = {
  ref: string;
  current: Set<string>;
  seenRefs: Set<string>;
};

export type MergeCommitsFn = (
  baseRef: string | undefined,
  leftRef: string,
  rightRef: string,
  depth: number,
) => string;

/**
 * This function walks up the tree starting at the commits in a breadth-first manner, merging commits as common ancestors are found.
 *
 * Those merged commits then continue to be merged together until there is just one head commit left.
 *
 * If there are completely un-connected commits, these will be merged with base === undefined
 */
export function mergeHeads<N extends MergableCommit>(
  refs: string[],
  getCommit: (ref: string) => N,
  merge: MergeCommitsFn,
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
    if (baseRef === aRef || baseRef === bRef) {
      throw new Error('unexpected merge with base === left/right');
    }
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
    let hasCommits = false;
    for (let i = 0; i < visitors.length; i++) {
      const leaf = visitors[i];
      const nextCommitRefs = new Set<string>();
      for (const commitRef of leaf.current) {
        for (let j = 0; j < visitors.length; j++) {
          if (j !== i && visitors[j].seenRefs.has(commitRef)) {
            mergeVisitors(i, j, commitRef);
            return true;
          }
        }
        const { baseRef, mergeRef } = getCommit(commitRef);
        if (baseRef !== undefined) {
          nextCommitRefs.add(baseRef);
          leaf.seenRefs.add(baseRef);
          hasCommits = true;
        }
        if (mergeRef !== undefined) {
          nextCommitRefs.add(mergeRef);
          leaf.seenRefs.add(mergeRef);
          hasCommits = true;
        }
        leaf.current = nextCommitRefs;
      }
    }
    depth++;
    return hasCommits;
  }

  while (iterate());

  if (visitors.length > 1) {
    // If we still have multiple visitors, we have unconnected root commits (undefined baseRef)
    // Sort them deterministically and merge from left to right: e.g. merge(merge(merge(0,1),2),3)
    visitors.sort((a, b) => (a.ref < b.ref ? -1 : 1));
    while (visitors.length > 1) {
      mergeVisitors(0, 1);
    }
  }
  return visitors[0]?.ref;
}
