import { useEffect, useMemo, useState } from 'react';
import {
  CursorInfo,
  Differ,
  GetSyncBackendFn,
  TrimergeClient,
} from 'trimerge-sync';
import { createIndexedDbBackendFactory } from 'trimerge-sync-indexed-db';

export type UpdateStateFn<State, EditMetadata> = (
  newState: State,
  editMetadata: EditMetadata,
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

export function useTrimergeState<State, EditMetadata, Delta, CursorState>(
  docId: string,
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
): [
  State,
  UpdateStateFn<State, EditMetadata>,
  readonly CursorInfo<CursorState>[],
] {
  const client = getCachedTrimergeClient(docId, userId, cursorId, differ);
  const [state, setState] = useState(client.state);
  const [cursors, setCursors] = useState(client.cursors);

  const updateState = useMemo(() => client.addEdit.bind(client), [client]);

  // Setup client
  useEffect(() => {
    const unsubState = client.subscribeState(setState);
    const unsubCursors = client.subscribeCursors(setCursors);
    return () => {
      unsubState();
      unsubCursors();
      client.shutdown();
    };
  }, [client]);

  return [state, updateState, cursors];
}
