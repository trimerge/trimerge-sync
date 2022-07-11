import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClientList,
  CoordinatingLocalStore,
  Differ,
  SyncStatus,
  TrimergeClient,
  GetLocalStoreFn,
} from 'trimerge-sync';
import {
  IndexedDbCommitRepository,
  deleteDocDatabase,
} from 'trimerge-sync-indexed-db';
import { WebsocketRemote } from 'submodules/trimerge-sync/example/trimerge-sync-basic-client/src';
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

function createIndexedDbBackendFactory(
  docId: string,
): GetLocalStoreFn<any, any, any> {
  return (userId, clientId, onEvent) => {
    const store = new CoordinatingLocalStore(
      userId,
      clientId,
      onEvent,
      new IndexedDbCommitRepository(docId, {
        localIdGenerator: randomId,
        remoteId: 'localhost',
      }),
      (userId, lastSyncId, onEvent) =>
        new WebsocketRemote(
          { userId, readonly: false },
          lastSyncId,
          onEvent,
          `ws://localhost:4444/${encodeURIComponent(docId)}`,
        ),
    );
    return store;
  };
}

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
  if (!TRIMERGE_CLIENT_CACHE[key]) {
    TRIMERGE_CLIENT_CACHE[key] = new TrimergeClient(
      userId,
      clientId,
      createIndexedDbBackendFactory(docId),
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
