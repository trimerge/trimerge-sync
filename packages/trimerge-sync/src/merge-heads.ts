import { CommitInfo } from './types';

type Visitor = {
  ref: string;
  current: Set<string>;
  seenRefs: Set<string>;
  linearHistoryRefs: Set<string>;
  refWalks: string[][][]; // refs in order of discovery
};

export type MergeCommitsFn = (
  baseRef: string | undefined,
  leftRef: string,
  rightRef: string,
  depth: number,
  reference: boolean,
) => string;

export type SortRefsFn = (refA: string, refB: string) => number;

export type GetCommitFn<N extends CommitInfo> = (ref: string) => N;
export type GetMergeRefFn = (
  leftRef: string,
  rightRef: string,
) => string | undefined;

export function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  const result = new Set<T>();
  for (const item of a) {
    if (b.has(item)) {
      result.add(item);
    }
  }
  return result;
}

/**
 * This function walks up the tree starting at the commits in a breadth-first manner, merging commits,
 * prioritizing lowest refs first, as common ancestors are found.
 *
 * Those merged commits then continue to be merged together until there is just one head commit left.
 *
 * If there are completely un-connected commits, these will be merged with base === undefined
 */
export function mergeHeads<N extends CommitInfo>(
  headRefs: string[],
  sortRefs: SortRefsFn,
  getCommit: GetCommitFn<N>,
  getMergeRef: GetMergeRefFn,
  reuseMerge: (ref: string) => string,
  merge: MergeCommitsFn,
  reference: boolean = false,
): string | undefined {
  function sortVisitors(a: Visitor, b: Visitor): number {
    const result = sortRefs(a.ref, b.ref);
    if (!result) {
      return a.ref > b.ref ? 1 : -1;
    }
    return result;
  }

  const visitors = headRefs
    .map(
      (ref): Visitor => ({
        ref,
        current: new Set([ref]),
        seenRefs: new Set([ref]),
        refWalks: [[[ref]]],
        linearHistoryRefs: new Set([ref]),
      }),
    )
    .sort(sortVisitors);
  let depth = 0;

  const findHeads = (rootRef: string, sharedRefs: Set<string>): string[] => {
    const heads = new Set([rootRef]);
    const sortedRefs = Array.from(sharedRefs).sort((a, b) => sortRefs(a, b));
    for (const ref of sortedRefs) {
      const commit = getCommit(ref);
      if (commit.baseRef) {
        heads.delete(commit.baseRef);
      }
      if (commit.mergeRef) {
        heads.delete(commit.mergeRef);
      }
      heads.add(commit.ref);
    }

    return Array.from(heads);
  };

  function mergeVisitors(i: number, j: number, baseRef?: string) {
    const [a, b] = [visitors[i], visitors[j]].sort(sortVisitors);
    const aRef = a.ref;
    const bRef = b.ref;

    // In some scenarios, we can get refs where one
    // is an ancestor of the other, in which case we
    // just return the descendant.
    if (baseRef === aRef || baseRef === bRef) {
      visitors[i] = baseRef === aRef ? b : a;
      visitors.splice(j, 1);
      return;
    }

    // Short circuit if we've already computed this merge.
    const existingMergeRef = getMergeRef(aRef, bRef);

    if (!existingMergeRef && baseRef) {
      // find overlapping nodes between the histories of a and b
      const common = intersect(a.seenRefs, b.seenRefs);

      // it's possible that the overlapping history of a and b is a graph
      const heads = findHeads(baseRef, common);

      // if there are multiple heads, we merge them together
      if (heads.length > 1) {
        // create a reference merge that we use as the base ref
        // when merging this
        baseRef = mergeHeads(
          heads,
          sortRefs,
          getCommit,
          getMergeRef,
          reuseMerge,
          merge,
          true,
        );
      } else {
        baseRef = heads[0];
      }
    }

    visitors[i] = {
      ref: existingMergeRef
        ? reuseMerge(existingMergeRef)
        : merge(baseRef, aRef, bRef, depth, reference),
      current: new Set([...a.current, ...b.current]),
      seenRefs: new Set([...a.seenRefs, ...b.seenRefs]),
      refWalks: [...a.refWalks, ...b.refWalks],
      linearHistoryRefs: new Set([
        ...a.linearHistoryRefs,
        ...b.linearHistoryRefs,
      ]),
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
          if (
            j !== i &&
            visitors[j].linearHistoryRefs.has(commitRef) &&
            visitors[j].current.size <= 1 &&
            visitors[i].current.size <= 1
          ) {
            mergeVisitors(i, j, commitRef);
            return visitors.length > 1;
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
      }
      for (const refWalk of leaf.refWalks) {
        refWalk.push(Array.from(leaf.current));
      }
      if (nextCommitRefs.size === 1) {
        // Should we be truncating linear history when history becomes non-linear?
        leaf.linearHistoryRefs.add(nextCommitRefs.values().next().value);
      }
      leaf.current = nextCommitRefs;
    }
    depth++;
    return hasCommits;
  }

  while (iterate());

  if (visitors.length > 1) {
    // If we still have multiple visitors, we have unconnected root commits (undefined baseRef)
    // Merge from left to right: e.g. merge(merge(merge(0,1),2),3)
    while (visitors.length > 1) {
      mergeVisitors(0, 1);
    }
  }

  return visitors[0]?.ref;
}
