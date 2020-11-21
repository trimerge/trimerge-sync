// Basic trimerge function that merges values, strings, and objects
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { Differ, MergeStateFn } from 'trimerge-sync';
import Jssha from 'jssha';
import { create, Delta } from 'jsondiffpatch';
import { produce } from 'immer';

const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);

const mergeHeadsFn: MergeStateFn<any, string> = (base, left, right) => ({
  value: trimergeObjects(base?.value, left.value, right.value),
  editMetadata: `merge`,
});

function refHash(
  baseRef: string | undefined,
  baseRef2: string | undefined,
  delta: any,
  editMetadata: any,
): string {
  const sha = new Jssha('SHA-256', 'TEXT', { encoding: 'UTF8' });
  sha.update(JSON.stringify([baseRef, baseRef2, delta, editMetadata]));
  return sha.getHash('HEX');
}

const jdp = create({ textDiff: { minLength: 20 } });

function immerPatch<T>(base: T, delta: Delta | undefined): T {
  if (delta === undefined) {
    return base;
  }
  return produce(base, (draft) => jdp.patch(draft, delta));
}

export const differ: Differ<any, string, any> = {
  diff: (left, right) => jdp.diff(left, right),
  patch: immerPatch,
  computeRef: refHash,
  merge: mergeHeadsFn,
};
