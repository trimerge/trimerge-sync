import { Delta } from 'jsondiffpatch';

import { useTrimergeState } from './lib/trimergeHooks';
import { diff, merge, patch } from './lib/trimergeDiffer';
import { StateWithUsers } from 'trimerge-sync-user-state';
import { Differ } from 'trimerge-sync';
import { computeRef } from 'trimerge-sync-hash';
import { currentTabId } from './lib/currentTabId';

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
  initialState: defaultState,
  diff,
  patch: (priorOrNext, delta) => patch(priorOrNext, delta) ?? defaultState,
  computeRef,
  merge,
};

export function useDemoAppState() {
  return useTrimergeState<AppState, string, Delta, unknown>(
    'demo',
    'local',
    currentTabId,
    differ,
  );
}
