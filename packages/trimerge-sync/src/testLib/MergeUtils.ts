// Basic trimerge function that merges values, strings, and objects
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { create, Delta } from 'jsondiffpatch';
import { MergeStateFn } from '../differ';
import { produce } from 'immer';
import { TrimergeClient } from '../TrimergeClient';
import { DiffNode } from '../TrimergeSyncBackend';
import { computeRef as computeShaRef } from 'trimerge-sync-hash';

const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);
export const merge: MergeStateFn<any, any> = (base, left, right) => ({
  value: trimergeObjects(base?.value, left.value, right.value),
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

export function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function getNodeLabel(client: TrimergeClient<any, any, any, any>) {
  return (node: DiffNode<any, any>) =>
    `${node.ref}
${JSON.stringify(client.getNodeState(node.ref).value)}`;
}

export function computeRef(
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: any,
  editMetadata: any,
): string {
  return computeShaRef(baseRef, mergeRef, delta, editMetadata).slice(0, 8);
}
