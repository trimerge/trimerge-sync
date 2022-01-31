import type { Differ, MergeDocFn } from 'trimerge-sync';

// Basic trimerge function that merges values, strings, and objects
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { create, Delta } from 'jsondiffpatch';
import { produce } from 'immer';
import { computeRef as computeShaRef } from 'trimerge-sync-hash';
import { makeMergeAllBranchesFn, MergeAllBranchesFn } from 'trimerge-sync';

const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);
export const merge: MergeDocFn<any, any> = (base, left, right) => ({
  doc: trimergeObjects(base?.doc, left.doc, right.doc),
  metadata: {
    ref: `(${left.ref}+${right.ref})`,
    message: `merge`,
  },
});
export const mergeAllBranches: MergeAllBranchesFn<any, any> =
  makeMergeAllBranchesFn((a, b) => (a < b ? -1 : 1), merge);

export const jdp = create({ textDiff: { minLength: 20 } });

export function patch<T>(base: T, delta: Delta | undefined): T {
  if (delta === undefined) {
    return base;
  }
  return produce(base, (draft) => jdp.patch(draft, delta));
}

export function diff<T>(left: T, right: T) {
  return jdp.diff(left, right);
}

export function computeRef(
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: any,
): string {
  return computeShaRef(baseRef, mergeRef, delta).slice(0, 8);
}

type TestEditMetadata = string;
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

export const differ: Differ<
  TestSavedDoc,
  TestDoc,
  TestEditMetadata,
  TestPresence
> = {
  migrate: (doc, metadata) => ({ doc, metadata }),
  diff,
  patch,
  computeRef,
  mergeAllBranches,
};
