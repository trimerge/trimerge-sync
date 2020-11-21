import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Differ, TrimergeClient } from 'trimerge-sync';
import { TrimergeIndexedDb } from 'trimerge-sync-indexed-db';

export type UpdateStateFn<State, EditMetadata> = (
  newState: State,
  editMetadata: EditMetadata,
) => void;

export function useTrimergeState<State, EditMetadata, Delta>(
  docId: string,
  differ: Differ<State, EditMetadata, Delta>,
  defaultState: State,
): [State, UpdateStateFn<State, EditMetadata> | undefined];

export function useTrimergeState<State, EditMetadata, Delta>(
  docId: string,
  differ: Differ<State, EditMetadata, Delta>,
  defaultState?: State,
): [State | undefined, UpdateStateFn<State, EditMetadata> | undefined];

export function useTrimergeState<State, EditMetadata, Delta>(
  docId: string,
  differ: Differ<State, EditMetadata, Delta>,
  defaultState?: State,
): [State | undefined, UpdateStateFn<State, EditMetadata> | undefined] {
  const [state, setState] = useState<State | undefined>(defaultState);

  const [client, setClient] = useState<
    TrimergeClient<State, EditMetadata, Delta> | undefined
  >(undefined);

  const updateState = useMemo(() => client && client.addEdit.bind(client), [
    client,
  ]);

  // Setup client
  useEffect(() => {
    let mounted = true;
    let unsub: (() => void) | undefined;
    const store = new TrimergeIndexedDb<State, EditMetadata, Delta>(
      docId,
      differ,
    );
    TrimergeClient.create(store, differ).then((_client) => {
      if (mounted) {
        setClient(_client);
        unsub = _client.subscribe(setState);
      }
    });
    return () => {
      unsub?.();
      store?.close();
      mounted = false;
    };
  }, [docId, differ]);

  // Unmount client
  useEffect(() => {
    if (client) {
      return () => {
        client.shutdown();
      };
    }
  }, [client]);
  return [state, updateState];
}
