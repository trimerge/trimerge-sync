import type { Differ, MergeStateFn } from 'trimerge-sync';

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

const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);
export const merge: MergeStateFn<any, any> = (base, left, right) => ({
  doc: trimergeObjects(base?.state, left.state, right.state),
  editMetadata: {
    ref: `(${left.ref}+${right.ref})`,
    message: `merge`,
  },
});
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
  editMetadata: any,
): string {
  return computeShaRef(baseRef, mergeRef, delta, editMetadata).slice(0, 8);
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
  migrate: (state, editMetadata) => ({ doc, editMetadata }),
  diff,
  patch,
  computeRef,
  merge,
};
