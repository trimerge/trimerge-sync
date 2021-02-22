import { useEffect, useMemo, useState } from 'react';
import { CursorInfo, Differ, TrimergeClient } from 'trimerge-sync';
import { createIndexedDbBackendFactory } from 'trimerge-sync-indexed-db';

export type UpdateStateFn<State, EditMetadata> = (
  newState: State,
  editMetadata: EditMetadata,
) => void;
export type UpdateCursorStateFn<CursorState> = (
  newCursorState: CursorState,
) => void;

const TRIMERGE_CLIENT_CACHE: Record<
  string,
  TrimergeClient<any, any, any, any>
> = {};

function getCachedTrimergeClient<State, EditMetadata, Delta, CursorState>(
  docId: string,
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
) {
  const key = `${docId}:${userId}:${cursorId}`;
  if (!TRIMERGE_CLIENT_CACHE[key]) {
    TRIMERGE_CLIENT_CACHE[key] = new TrimergeClient<
      State,
      EditMetadata,
      Delta,
      CursorState
    >(userId, cursorId, createIndexedDbBackendFactory(docId), differ);
  }
  return TRIMERGE_CLIENT_CACHE[key];
}

export function useTrimergeStateShutdown<
  State,
  EditMetadata,
  Delta,
  CursorState
>(
  docId: string,
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
): void {
  const client = getCachedTrimergeClient(docId, userId, cursorId, differ);

  // Setup client
  useEffect(() => {
    return () => {
      client.shutdown();
    };
  }, [client]);
}
export function useTrimergeState<State, EditMetadata, Delta, CursorState>(
  docId: string,
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
): [State, UpdateStateFn<State, EditMetadata>] {
  const client = getCachedTrimergeClient(docId, userId, cursorId, differ);
  const [state, setState] = useState(client.state);

  const updateState = useMemo(() => client.updateState.bind(client), [client]);

  useEffect(() => client.subscribeState(setState), [client]);

  return [state, updateState];
}

export function useTrimergeCursors<State, EditMetadata, Delta, CursorState>(
  docId: string,
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
): [readonly CursorInfo<CursorState>[], UpdateCursorStateFn<CursorState>] {
  const client = getCachedTrimergeClient(docId, userId, cursorId, differ);
  const [cursors, setCursors] = useState(client.cursors);

  const updateCursorState = useMemo(() => client.updateCursor.bind(client), [
    client,
  ]);

  useEffect(() => client.subscribeCursors(setCursors), [client]);

  return [cursors, updateCursorState];
}
