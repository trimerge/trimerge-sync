import { Delta } from 'jsondiffpatch';

import { useIndexedDbSyncBackend, useTrimergeState } from './lib/trimergeHooks';
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
  patch(priorOrNext, delta) {
    return patch(priorOrNext, delta) ?? defaultState;
  },
  computeRef,
  merge,
};

export function useDemoAppState() {
  const getSyncBackend = useIndexedDbSyncBackend<string, Delta, unknown>(
    'demo',
  );
  return useTrimergeState<AppState, string, Delta, unknown>(
    'local',
    currentTabId,
    differ,
    getSyncBackend,
  );
}
