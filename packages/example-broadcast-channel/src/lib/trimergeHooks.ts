import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClientList,
  Differ,
  PassthroughLocalStore,
  SyncStatus,
  TrimergeClient,
} from 'trimerge-sync';
import {
  createIndexedDbBackendFactory,
  deleteDocDatabase,
} from 'trimerge-sync-indexed-db';
import {
  SharedWorkerRemote,
  WebsocketRemote,
} from 'trimerge-sync-basic-client';
import { randomId } from './randomId';

export type UpdateDocFn<LatestDoc, CommitMetadata> = (
  doc: LatestDoc,
  metadata: CommitMetadata,
) => void;
export type UpdatePresenceFn<Presence> = (newPresence: Presence) => void;

const TRIMERGE_CLIENT_CACHE: Record<
  string,
  TrimergeClient<any, any, any, any, any>
> = {};

function getCachedTrimergeClient<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, LatestDoc, CommitMetadata, Delta>,
) {
  const key = `${docId}:${userId}:${clientId}`;

  const worker = new SharedWorker(
    new URL('./TrimergeShared.worker', import.meta.url),
  );

  if (!TRIMERGE_CLIENT_CACHE[key]) {
    TRIMERGE_CLIENT_CACHE[key] = new TrimergeClient(
      userId,
      clientId,
      (userId, clientId, onEvent) =>
        new PassthroughLocalStore(
          userId,
          clientId,
          new SharedWorkerRemote(onEvent, worker),
        ),
      differ,
    );
  }
  return TRIMERGE_CLIENT_CACHE[key];
}

export function useTrimergeStateShutdown<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, LatestDoc, CommitMetadata, Delta>,
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
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, LatestDoc, CommitMetadata, Delta>,
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

export function useTrimergeDoc<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, LatestDoc, CommitMetadata, Delta>,
): [LatestDoc, UpdateDocFn<LatestDoc, CommitMetadata>] {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [doc, setDoc] = useState(client.doc);

  const updateState = useMemo(() => client.updateDoc.bind(client), [client]);

  useEffect(() => client.subscribeDoc(setDoc), [client]);

  return [doc, updateState];
}

export function useTrimergeClientList<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
  Presence,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, LatestDoc, CommitMetadata, Delta>,
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
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
>(
  docId: string,
  userId: string,
  clientId: string,
  differ: Differ<SavedDoc, LatestDoc, CommitMetadata, Delta>,
): SyncStatus {
  const client = getCachedTrimergeClient(docId, userId, clientId, differ);
  const [status, setStatus] = useState(client.syncStatus);

  useEffect(() => client.subscribeSyncStatus(setStatus), [client]);

  return status;
}
