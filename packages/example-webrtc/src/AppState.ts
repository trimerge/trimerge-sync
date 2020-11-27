import { Delta } from 'jsondiffpatch';

import { useTrimergeState } from './lib/trimergeClient';
import { diff, merge, patch } from './lib/trimergeDiffer';
import { StateWithUsers } from 'trimerge-sync-user-state';
import { Differ } from 'trimerge-sync';
import { computeRef } from 'trimerge-sync-hash';

export type AppState = StateWithUsers & {
  title: string;
  text: string;
};
export const defaultState = {
  title: '',
  text: '',
  users: {},
};

export const differ: Differ<AppState, string, Delta> = {
  normalize: (state) => [state ?? defaultState, 'initialize'],
  diff,
  patch(priorOrNext, delta) {
    return patch(priorOrNext, delta) ?? defaultState;
  },
  computeRef,
  merge,
};

export function useDemoAppState() {
  return useTrimergeState<AppState, string, Delta>(
    'demo',
    differ,
    defaultState,
  );
}
