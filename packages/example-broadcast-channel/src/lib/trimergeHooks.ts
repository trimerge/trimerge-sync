import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientList, Differ, SyncStatus, TrimergeClient } from 'trimerge-sync';
import {
  createIndexedDbBackendFactory,
  deleteDocDatabase,
} from 'trimerge-sync-indexed-db';
import { WebsocketRemote } from './WebsocketRemote';

export type UpdateStateFn<State, EditMetadata> = (
  newState: State,
  editMetadata: EditMetadata,
) => void;
export type UpdatePresenceFn<PresenceState> = (
  newPresenceState: PresenceState,
) => void;

const TRIMERGE_CLIENT_CACHE: Record<
  string,
  TrimergeClient<any, any, any, any>
> = {};

function getCachedTrimergeClient<State, EditMetadata, Delta, PresenceState>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<State, EditMetadata, Delta>,
) {
  const key = `${docId}:${userId}:${clientId}`;
  if (!TRIMERGE_CLIENT_CACHE[key]) {
    TRIMERGE_CLIENT_CACHE[key] = new TrimergeClient<
      State,
      EditMetadata,
      Delta,
      PresenceState
    >(
      userId,
      clientId,
      createIndexedDbBackendFactory(
        docId,
        (userId, lastSyncId, onEvent) =>
          new WebsocketRemote(
            userId,
            onEvent,
            `ws://localhost:4444/${encodeURIComponent(
              docId,
            )}?userId=${encodeURIComponent(userId)}${
              lastSyncId !== undefined
                ? `&lastSyncId=${encodeURIComponent(lastSyncId)}`
                : ''
            }`,
          ),
      ),
      differ,
      100,
    );
  }
  return TRIMERGE_CLIENT_CACHE[key];
}

export function useTrimergeStateShutdown<State, EditMetadata, Delta>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<State, EditMetadata, Delta>,
): void {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);

  // Setup client
  useEffect(() => {
    return () => {
      client.shutdown();
    };
  }, [client]);
}

export function useTrimergeDeleteDatabase<State, EditMetadata, Delta>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<State, EditMetadata, Delta>,
): () => Promise<void> {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);

  return useCallback(async () => {
    if (window.confirm('Are you sure you want to clear your local database?')) {
      client.shutdown();
      await deleteDocDatabase(docId);
      window.location.reload();
    }
  }, [client, docId]);
}

export function useTrimergeState<State, EditMetadata, Delta>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<State, EditMetadata, Delta>,
): [State, UpdateStateFn<State, EditMetadata>] {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [state, setState] = useState(client.state);

  const updateState = useMemo(() => client.updateState.bind(client), [client]);

  useEffect(() => client.subscribeState(setState), [client]);

  return [state, updateState];
}

export function useTrimergeClientList<
  State,
  EditMetadata,
  Delta,
  PresenceState
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<State, EditMetadata, Delta>,
): [ClientList<PresenceState>, UpdatePresenceFn<PresenceState>] {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [clients, setClients] = useState(client.clients);

  const updatePresenceState = useMemo(
    () => client.updatePresence.bind(client),
    [client],
  );

  useEffect(() => client.subscribeClientList(setClients), [client]);

  return [clients, updatePresenceState];
}

export function useTrimergeSyncStatus<State, EditMetadata, Delta>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<State, EditMetadata, Delta>,
): SyncStatus {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [status, setStatus] = useState(client.syncStatus);

  useEffect(() => client.subscribeSyncStatus(setStatus), [client]);

  return status;
}
