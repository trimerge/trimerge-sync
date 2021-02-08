import { useEffect, useMemo, useState } from 'react';
import { Differ, GetSyncBackendFn, TrimergeClient } from 'trimerge-sync';
import { TrimergeIndexedDb } from 'trimerge-sync-indexed-db';
import { Delta } from 'jsondiffpatch';
import { AppState, differ } from '../AppState';

export type UpdateStateFn<State, EditMetadata> = (
  newState: State,
  editMetadata: EditMetadata,
) => void;

export function useGetSyncBackend<State, EditMetadata, Delta>(
  docId: string,
  differ: Differ<State, EditMetadata, Delta>,
) {
  return useMemo(
    () => new TrimergeIndexedDb<AppState, string, Delta>(docId, differ),
    [differ, docId],
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
