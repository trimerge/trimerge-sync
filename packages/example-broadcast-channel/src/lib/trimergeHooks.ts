import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientList, Differ, SyncStatus, TrimergeClient } from 'trimerge-sync';
import {
  createIndexedDbBackendFactory,
  deleteDocDatabase,
} from 'trimerge-sync-indexed-db';
import { WebsocketRemote } from 'trimerge-sync-basic-client';
import { randomId } from './randomId';

export type UpdateDocFn<Doc, EditMetadata> = (
  doc: Doc,
  editMetadata: EditMetadata,
) => void;
export type UpdatePresenceFn<Presence> = (newPresence: Presence) => void;

const TRIMERGE_CLIENT_CACHE: Record<
  string,
  TrimergeClient<any, any, any, any, any>
> = {};

function getCachedTrimergeClient<
  SavedDoc,
  Doc extends SavedDoc,
  EditMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, Doc, EditMetadata, Delta>,
) {
  const key = `${docId}:${userId}:${clientId}`;
  if (!TRIMERGE_CLIENT_CACHE[key]) {
    TRIMERGE_CLIENT_CACHE[key] = new TrimergeClient(
      userId,
      clientId,
      createIndexedDbBackendFactory(docId, {
        getRemote: (userId, lastSyncId, onEvent) =>
          new WebsocketRemote(
            { userId, readonly: false },
            lastSyncId,
            onEvent,
            `ws://localhost:4444/${encodeURIComponent(docId)}`,
          ),
        localIdGenerator: randomId,
        remoteId: 'localhost',
      }),
      differ,
      100,
    );
  }
  return TRIMERGE_CLIENT_CACHE[key];
}

export function useTrimergeStateShutdown<
  SavedDoc,
  Doc extends SavedDoc,
  EditMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, Doc, EditMetadata, Delta>,
): void {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);

  // Setup client
  useEffect(() => {
    return () => {
      client.shutdown();
    };
  }, [client]);
}

export function useTrimergeDeleteDatabase<
  SavedDoc,
  Doc extends SavedDoc,
  EditMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, Doc, EditMetadata, Delta>,
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

export function useTrimergeState<
  SavedDoc,
  Doc extends SavedDoc,
  EditMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, Doc, EditMetadata, Delta>,
): [Doc, UpdateDocFn<Doc, EditMetadata>] {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [state, setState] = useState(client.state);

  const updateState = useMemo(() => client.updateState.bind(client), [client]);

  useEffect(() => client.subscribeState(setState), [client]);

  return [state, updateState];
}

export function useTrimergeClientList<
  SavedDoc,
  Doc extends SavedDoc,
  EditMetadata,
  Delta,
  Presence,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, Doc, EditMetadata, Delta>,
): [ClientList<Presence>, UpdatePresenceFn<Presence>] {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [clients, setClients] = useState(client.clients);

  const updatePresence = useMemo(
    () => client.updatePresence.bind(client),
    [client],
  );

  useEffect(() => client.subscribeClientList(setClients), [client]);

  return [clients, updatePresence];
}

export function useTrimergeSyncStatus<
  SavedDoc,
  Doc extends SavedDoc,
  EditMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, Doc, EditMetadata, Delta>,
): SyncStatus {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [status, setStatus] = useState(client.syncStatus);

  useEffect(() => client.subscribeSyncStatus(setStatus), [client]);

  return status;
}
