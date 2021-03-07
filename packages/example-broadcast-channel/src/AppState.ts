import { Delta } from 'jsondiffpatch';

import {
  useTrimergeCursors,
  useTrimergeState,
  useTrimergeStateShutdown,
} from './lib/trimergeHooks';
import { diff, merge, patch } from './lib/trimergeDiffer';
import { Differ } from 'trimerge-sync';
import { computeRef } from 'trimerge-sync-hash';
import { currentTabId } from './lib/currentTabId';
import { FocusCursorState } from './lib/FocusCursorState';

export type AppState = {
  title: string;
  text: string;
};
export const defaultState = {
  title: '',
  text: '',
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

export function useDemoAppCursors() {
  return useTrimergeCursors<AppState, string, Delta, FocusCursorState>(
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
