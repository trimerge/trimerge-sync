import { Delta } from 'jsondiffpatch';

import {
  useTrimergeClientList,
  useTrimergeDeleteDatabase,
  useTrimergeState,
  useTrimergeStateShutdown,
  useTrimergeSyncStatus,
} from './lib/trimergeHooks';
import { diff, merge, patch } from './lib/trimergeDiffer';
import { Differ } from 'trimerge-sync';
import { computeRef } from 'trimerge-sync-hash';
import { currentTabId } from './lib/currentTabId';
import { FocusPresenceState } from './lib/FocusPresenceState';

type AppStateV1 = {
  title: string;
  text: string;
  slider: number;
};
type SavedState = AppStateV1;

export type AppState = AppStateV1;

export const defaultState = {
  title: '',
  text: '',
  slider: 0,
};

export const differ: Differ<SavedState, AppState, string, Delta> = {
  migrate: (state) => state,
  diff,
  patch: (priorOrNext, delta) => patch(priorOrNext, delta) ?? defaultState,
  computeRef,
  merge,
};

const DEMO_DOC_ID = 'demo';
const DEMO_USER_ID = 'local';
export function useDemoAppState() {
  return useTrimergeState<SavedState, AppState, string, Delta>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}

export function useDemoAppDeleteDatabase() {
  return useTrimergeDeleteDatabase(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}

export function useDemoAppClientList() {
  return useTrimergeClientList<
    SavedState,
    AppState,
    string,
    Delta,
    FocusPresenceState
  >(DEMO_DOC_ID, DEMO_USER_ID, currentTabId, differ);
}
export function useDemoAppSyncStatus() {
  return useTrimergeSyncStatus<SavedState, AppState, string, Delta>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}
export function useDemoAppShutdown() {
  return useTrimergeStateShutdown<SavedState, AppState, string, Delta>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}
