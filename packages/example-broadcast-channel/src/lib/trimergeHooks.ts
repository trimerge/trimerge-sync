import { useEffect, useMemo, useState } from 'react';
import { Differ, GetSyncBackendFn, TrimergeClient } from 'trimerge-sync';
import { createIndexedDbBackendFactory } from 'trimerge-sync-indexed-db';

export type UpdateStateFn<State, EditMetadata> = (
  newState: State,
  editMetadata: EditMetadata,
) => void;

export function useIndexedDbSyncBackend<EditMetadata, Delta, CursorData>(
  docId: string,
) {
  return useMemo(
    () => createIndexedDbBackendFactory<EditMetadata, Delta, CursorData>(docId),
    [docId],
  );
}

export function useTrimergeState<State, EditMetadata, Delta, CursorData>(
  userId: string,
  cursorId: string,
  differ: Differ<State, EditMetadata, Delta>,
  getSyncBackend: GetSyncBackendFn<EditMetadata, Delta, CursorData>,
): [State, UpdateStateFn<State, EditMetadata>] {
  const client = useMemo(
    () => new TrimergeClient(userId, cursorId, getSyncBackend, differ),
    [cursorId, differ, getSyncBackend, userId],
  );
  const [state, setState] = useState(client.state);

  const updateState = useMemo(() => client.addEdit.bind(client), [client]);

  // Setup client
  useEffect(() => {
    const unsub = client.subscribe(setState);
    return () => {
      unsub();
      client.shutdown();
    };
  }, [client]);

  return [state, updateState];
}
