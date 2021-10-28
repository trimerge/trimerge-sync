// Basic trimerge function that merges values, strings, and objects
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { create, Delta } from 'jsondiffpatch';
import { MergeDocFn, DocAndMetadata } from '../differ';
import { produce } from 'immer';
import { computeRef as computeShaRef } from 'trimerge-sync-hash';

const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);
export const merge: MergeDocFn<any, any> = (base, left, right) => ({
  doc: trimergeObjects(base?.doc, left.doc, right.doc),
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

// Simple no-op migration for unit tests
export function migrate<Doc, EditMetadata>(
  doc: Doc,
  editMetadata: EditMetadata,
): DocAndMetadata<Doc, EditMetadata> {
  return { doc, editMetadata };
}

export function computeRef(
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: any,
  editMetadata: any,
): string {
  return computeShaRef(baseRef, mergeRef, delta, editMetadata).slice(0, 8);
}
