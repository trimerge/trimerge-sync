import type {
  AckCommitsEvent,
  AckRefErrors,
  BroadcastEvent,
  Commit,
  GetLocalStoreFn,
  GetRemoteFn,
  NetworkSettings,
  CommitsEvent,
  OnEventFn,
  RemoteSyncInfo,
} from 'trimerge-sync';
import { AbstractLocalStore } from 'trimerge-sync';
import type { DBSchema, IDBPDatabase, StoreValue } from 'idb';
import { deleteDB, openDB } from 'idb';
import { BroadcastChannel } from 'broadcast-channel';
import { timeout } from './lib/timeout';

const COMMIT_PAGE_SIZE = 100;

function getSyncCounter(
  commits: StoreValue<TrimergeSyncDbSchema, 'commits'>[],
): number {
  let syncCounter = 0;
  for (const commit of commits) {
    if (syncCounter < commit.syncId) {
      syncCounter = commit.syncId;
    }
  }
  return syncCounter;
}

function toSyncId(syncNumber: number): string {
  return syncNumber.toString(36);
}
function toSyncNumber(syncId: string | undefined): number {
  return syncId === undefined ? 0 : parseInt(syncId, 36);
}

type LocalIdGeneratorFn = () => Promise<string> | string;
export type IndexedDbBackendOptions<EditMetadata, Delta, PresenceState> = {
  getRemote?: GetRemoteFn<EditMetadata, Delta, PresenceState>;
  networkSettings?: Partial<NetworkSettings>;
  remoteId?: string;
  localIdGenerator: LocalIdGeneratorFn;
};

export function createIndexedDbBackendFactory<
  EditMetadata,
  Delta,
  PresenceState,
>(
  docId: string,
  options: IndexedDbBackendOptions<EditMetadata, Delta, PresenceState>,
): GetLocalStoreFn<EditMetadata, Delta, PresenceState> {
  return (userId, clientId, onEvent) =>
    new IndexedDbBackend(docId, userId, clientId, onEvent, options);
}

function getDatabaseName(docId: string): string {
  return `trimerge-sync:${docId}`;
}

/**
 * Deletes database for document.
 *
 * CAUSES DATA LOSS!
 */
export function deleteDocDatabase(docId: string): Promise<void> {
  return deleteDB(getDatabaseName(docId));
}

/**
 * Clears out all remote sync data for this table without removing any commits
 *
 * Should not cause data loss.
 */
export async function resetDocRemoteSyncData(docId: string): Promise<void> {
  const db = await getIDBPDatabase(docId);
  const tx = await db.transaction(['remotes', 'commits'], 'readwrite');
  const remotes = tx.objectStore('remotes');
  const commits = tx.objectStore('commits');
  await remotes.clear();
  for (const commit of await commits.getAll()) {
    if (commit.remoteSyncId) {
      commit.remoteSyncId = '';
      await commits.put(commit);
    }
  }
  await tx.done;
}

export function getIDBPDatabase(
  docId: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
  return createIndexedDb(getDatabaseName(docId));
}

class IndexedDbBackend<
  EditMetadata,
  Delta,
  PresenceState,
> extends AbstractLocalStore<EditMetadata, Delta, PresenceState> {
  private readonly dbName: string;
  private db: Promise<IDBPDatabase<TrimergeSyncDbSchema>>;
  private readonly channel: BroadcastChannel<
    BroadcastEvent<EditMetadata, Delta, PresenceState>
  >;
  private remoteId: string;
  private localIdGenerator: LocalIdGeneratorFn;

  public constructor(
    private readonly docId: string,
    userId: string,
    clientId: string,
    onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    {
      getRemote,
      networkSettings,
      remoteId = 'origin',
      localIdGenerator,
    }: IndexedDbBackendOptions<EditMetadata, Delta, PresenceState>,
  ) {
    super(userId, clientId, onEvent, getRemote, networkSettings);
    this.remoteId = remoteId;
    this.localIdGenerator = localIdGenerator;
    const dbName = getDatabaseName(docId);
    console.log(`[TRIMERGE-SYNC] new IndexedDbBackend(${dbName})`);
    this.dbName = dbName;
    this.db = this.connect();
    this.channel = new BroadcastChannel(dbName, { webWorkerSupport: false });
    this.channel.addEventListener('message', this.onLocalBroadcastEvent);
    this.initialize().catch(this.handleAsError('internal'));
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.shutdown);
    }
  }

  protected broadcastLocal(
    event: BroadcastEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    return this.channel.postMessage(event).catch(this.handleAsError('network'));
  }

  protected async *getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, PresenceState>
  > {
    const db = await this.db;
    const unsentcommits = await db.getAllFromIndex(
      'commits',
      'remoteSyncId',
      '',
    );
    if (unsentcommits.length > 0) {
      // Sort by syncId
      unsentcommits.sort((a, b) => a.syncId - b.syncId);
      for (let i = 0; i < unsentcommits.length; i += COMMIT_PAGE_SIZE) {
        yield {
          type: 'commits',
          commits: unsentcommits.slice(i, i + COMMIT_PAGE_SIZE),
        };
      }
    }
  }

  protected async acknowledgeRemoteCommits(
    refs: readonly string[],
    remoteSyncCursor: string,
  ): Promise<void> {
    const db = await this.db;
    for (const ref of refs) {
      const commit = await db.get('commits', ref);
      if (commit && !commit.remoteSyncId) {
        commit.remoteSyncId = remoteSyncCursor;
        await db.put('commits', commit);
      }
    }
    await this.upsertRemoteSyncInfo(remoteSyncCursor);
  }

  protected async getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return this.upsertRemoteSyncInfo();
  }

  protected async upsertRemoteSyncInfo(
    syncCursor?: string,
  ): Promise<RemoteSyncInfo> {
    const db = await this.db;
    const tx = db.transaction(['remotes'], 'readwrite');
    const remotes = tx.objectStore('remotes');
    const remote = (await remotes.get(this.remoteId)) ?? {};
    let changed = false;
    if (!remote.localStoreId) {
      remote.localStoreId = await this.localIdGenerator();
      changed = true;
    }
    if (syncCursor !== undefined && remote.lastSyncCursor !== syncCursor) {
      remote.lastSyncCursor = syncCursor;
      changed = true;
    }
    if (changed) {
      await remotes.put(remote, this.remoteId);
    }
    await tx.done;
    return remote as RemoteSyncInfo;
  }

  private async connect(
    reconnect: boolean = false,
  ): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
    if (reconnect) {
      console.log(
        '[TRIMERGE-SYNC] IndexedDbBackend: reconnecting after 3 second timeout…',
      );
      await timeout(3_000);
    }
    const db = await createIndexedDb(this.dbName);
    db.onclose = () => {
      this.db = this.connect(true);
    };
    return db;
  }

  protected async addCommits(
    commits: readonly Commit<EditMetadata, Delta>[],
    lastSyncCursor: string | undefined,
  ): Promise<AckCommitsEvent> {
    const db = await this.db;
    const tx = db.transaction(['heads', 'commits'], 'readwrite');

    const headsDb = tx.objectStore('heads');
    const commitsDb = tx.objectStore('commits');

    const [currentHeads, syncIdCursor] = await Promise.all([
      headsDb.getAllKeys(),
      // Gets the last item in the commits db based on the syncId index
      commitsDb.index('syncId').openCursor(undefined, 'prev'),
    ]);
    let syncCounter = syncIdCursor?.value.syncId ?? 0;

    const priorHeads = new Set(currentHeads);
    const headsToDelete = new Set<string>();
    const headsToAdd = new Set<string>();
    const promises: Promise<unknown>[] = [];
    const refs = new Set<string>();
    const refErrors: AckRefErrors = {};
    async function commitExistsAlready(
      commit: Commit<unknown, unknown>,
      error?: string,
    ): Promise<boolean> {
      const existingCommit = await commitsDb.get(commit.ref);
      if (existingCommit) {
        refs.add(commit.ref);
        console.warn(`already have commit`, { commit, existingCommit, error });
        return true;
      }
      return false;
    }

    for (const commit of commits) {
      const syncId = ++syncCounter;
      const { ref, baseRef, mergeRef } = commit;
      promises.push(
        (async () => {
          try {
            if (await commitExistsAlready(commit)) {
              return;
            }
            await commitsDb.add({ syncId, remoteSyncId: '', ...commit });
            refs.add(ref);
          } catch (e) {
            refErrors[ref] = {
              code: 'storage-failure',
              message: e instanceof Error ? e.message : String(e),
            };
            console.warn(`error inserting commit`, { commit }, e);
          }
        })(),
      );
      if (baseRef !== undefined) {
        headsToDelete.add(baseRef);
      }
      if (mergeRef !== undefined) {
        headsToDelete.add(mergeRef);
      }
      headsToAdd.add(ref);
    }
    for (const ref of headsToDelete) {
      headsToAdd.delete(ref);
      if (priorHeads.has(ref)) {
        promises.push(headsDb.delete(ref));
      }
    }
    for (const ref of headsToAdd) {
      promises.push(headsDb.put({ ref }));
    }

    if (lastSyncCursor) {
      await this.upsertRemoteSyncInfo(lastSyncCursor);
    }

    await Promise.all(promises);
    await tx.done;

    return {
      type: 'ack',
      refs: Array.from(refs),
      refErrors,
      syncId: toSyncId(syncCounter),
    };
  }

  protected async *getLocalCommits(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, PresenceState>
  > {
    const lastSyncCounter = toSyncNumber(undefined);
    const db = await this.db;
    const commits = await db.getAllFromIndex(
      'commits',
      'syncId',
      IDBKeyRange.lowerBound(lastSyncCounter, true),
    );
    const syncCounter = getSyncCounter(commits);
    yield {
      type: 'commits',
      commits,
      syncId: toSyncId(syncCounter),
    };
  }

  shutdown = async (): Promise<void> => {
    await super.shutdown();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.shutdown);
    }
    await this.channel.close();

    const db = await this.db;
    // To prevent reconnect
    db.onclose = null;
    db.close();
  };
}

interface TrimergeSyncDbSchema extends DBSchema {
  heads: {
    key: string;
    value: {
      ref: string;
    };
  };
  commits: {
    key: string;
    value: Commit<any, any> & {
      syncId: number;
      remoteSyncId: string;
    };
    indexes: {
      syncId: number;
      remoteSyncId: string;
    };
  };
  remotes: {
    key: string;
    value: {
      localStoreId?: string;
      lastSyncCursor?: string;
    };
  };
}

function createIndexedDb(
  dbName: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
  return openDB<TrimergeSyncDbSchema>(dbName, 2, {
    upgrade(db, oldVersion, newVersion, tx) {
      let commits;
      if (oldVersion < 1) {
        db.createObjectStore('heads', { keyPath: 'ref' });
        commits = db.createObjectStore('commits', { keyPath: 'ref' });
        commits.createIndex('syncId', 'syncId');
      } else {
        commits = tx.objectStore('commits');
      }
      if (oldVersion < 2) {
        db.createObjectStore('remotes');
        commits.createIndex('remoteSyncId', 'remoteSyncId');
      }
    },
  });
}
