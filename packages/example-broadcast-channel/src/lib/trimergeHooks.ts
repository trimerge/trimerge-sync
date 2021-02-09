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

export function useIndexedDbSyncBackend<EditMetadata, Delta, CursorState>(
  docId: string,
) {
  return useMemo(
    () =>
      createIndexedDbBackendFactory<EditMetadata, Delta, CursorState>(docId),
    [docId],
  );
}

export function useTrimergeState<State, EditMetadata, Delta, CursorState>(
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
  getSyncBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
): [
  State,
  UpdateStateFn<State, EditMetadata>,
  readonly CursorInfo<CursorState>[],
] {
  const client = useMemo(
    () => new TrimergeClient(userId, cursorId, getSyncBackend, differ),
    [cursorId, differ, getSyncBackend, userId],
  );
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
