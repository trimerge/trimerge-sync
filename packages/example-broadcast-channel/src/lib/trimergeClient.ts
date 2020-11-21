import { useCallback, useEffect, useRef, useState } from 'react';
import { Differ, TrimergeClient } from 'trimerge-sync';
import { TrimergeIndexedDb } from 'trimerge-sync-indexed-db';

export function useTrimergeState<State, EditMetadata, Delta>(
  docId: string,
  differ: Differ<State, EditMetadata, Delta>,
): [State | undefined, (newState: State, editMetadata: EditMetadata) => void] {
  const [state, setState] = useState<State | undefined>(undefined);

  const client = useRef<TrimergeClient<State, EditMetadata, Delta> | undefined>(
    undefined,
  );
  const updateState = useCallback(
    (newState: State, editMetadata: EditMetadata) => {
      client.current?.addEdit(newState, editMetadata);
    },
    [],
  );
  useEffect(() => {
    let mounted = true;
    let store: TrimergeIndexedDb<State, EditMetadata, Delta> | undefined;
    let unsub: (() => void) | undefined;
    TrimergeIndexedDb.create<State, EditMetadata, Delta>(docId, differ)
      .then((_store) => {
        store = _store;
        return TrimergeClient.create(_store, differ);
      })
      .then((_client) => {
        if (mounted) {
          client.current = _client;
          unsub = _client.subscribe(setState);
        }
      });
    return () => {
      unsub?.();
      client.current?.shutdown();
      store?.close();
      mounted = false;
    };
  }, [docId, differ]);
  return [state, updateState];
}
