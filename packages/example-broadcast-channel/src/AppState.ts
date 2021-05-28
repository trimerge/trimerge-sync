import { Delta } from 'jsondiffpatch';

import {
  useTrimergeClientList,
  useTrimergeState,
  useTrimergeStateShutdown,
  useTrimergeSyncStatus,
} from './lib/trimergeHooks';
import { diff, merge, patch } from './lib/trimergeDiffer';
import { Differ } from 'trimerge-sync';
import { computeRef } from 'trimerge-sync-hash';
import { currentTabId } from './lib/currentTabId';
import { FocusPresenceState } from './lib/FocusPresenceState';

export type AppState = {
  title: string;
  text: string;
  slider: number;
};
export const defaultState = {
  title: '',
  text: '',
  slider: 0,
};

export const differ: Differ<AppState, string, Delta> = {
  diff,
  patch: (priorOrNext, delta) => patch(priorOrNext, delta) ?? defaultState,
  computeRef,
  merge,
};

const DEMO_DOC_ID = 'demo';
const DEMO_USER_ID = 'local';
export function useDemoAppState() {
  return useTrimergeState<AppState, string, Delta>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}

export function useDemoAppClientList() {
  return useTrimergeClientList<AppState, string, Delta, FocusPresenceState>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}
export function useDemoAppSyncStatus() {
  return useTrimergeSyncStatus<AppState, string, Delta>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}
export function useDemoAppShutdown() {
  return useTrimergeStateShutdown<AppState, string, Delta>(
    DEMO_DOC_ID,
    DEMO_USER_ID,
    currentTabId,
    differ,
  );
}
