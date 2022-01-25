import {
  AbstractLocalStore,
  AckCommitsEvent,
  AckRefErrors,
  BroadcastEvent,
  Commit,
  CommitAck,
  CommitsEvent,
  GetLocalStoreFn,
  GetRemoteFn,
  isMergeCommit,
  NetworkSettings,
  OnStoreEventFn,
  RemoteSyncInfo,
} from 'trimerge-sync';
import type { DBSchema, IDBPDatabase, StoreValue } from 'idb';
import { deleteDB, openDB } from 'idb';
import { BroadcastChannel } from 'broadcast-channel';
import { timeout } from './lib/timeout';

const COMMIT_PAGE_SIZE = 100;

function getSyncCounter<EditMetadata, Delta>(
  commits: StoreValue<TrimergeSyncDbSchema<EditMetadata, Delta>, 'commits'>[],
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
export type IndexedDbBackendOptions<EditMetadata, Delta, Presence> = {
  getRemote?: GetRemoteFn<EditMetadata, Delta, Presence>;
  networkSettings?: Partial<NetworkSettings>;
  remoteId?: string;
  localIdGenerator: LocalIdGeneratorFn;
  /** Add metadata to every local commit stored in client */
  addStoreMetadata?: AddStoreMetadataFn<EditMetadata>;
};

export function createIndexedDbBackendFactory<EditMetadata, Delta, Presence>(
  docId: string,
  options: IndexedDbBackendOptions<EditMetadata, Delta, Presence>,
): GetLocalStoreFn<EditMetadata, Delta, Presence> {
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

export function getIDBPDatabase<EditMetadata, Delta>(
  docId: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema<EditMetadata, Delta>>> {
  return createIndexedDb(getDatabaseName(docId));
}
export type AddStoreMetadataFn<EditMetadata> = (
  metadata: EditMetadata,
  localStoreId: string,
  commitIndex: number,
) => EditMetadata;

class IndexedDbBackend<
  EditMetadata,
  Delta,
  Presence,
> extends AbstractLocalStore<EditMetadata, Delta, Presence> {
  private readonly dbName: string;
  private db: Promise<IDBPDatabase<TrimergeSyncDbSchema<EditMetadata, Delta>>>;
  private readonly channel: BroadcastChannel<
    BroadcastEvent<EditMetadata, Delta, Presence>
  >;
  private readonly remoteId: string;
  private readonly localIdGenerator: LocalIdGeneratorFn;
  private readonly addStoreMetadata?: AddStoreMetadataFn<EditMetadata>;
  private localStoreId: Promise<string>;

  public constructor(
    private readonly docId: string,
    userId: string,
    clientId: string,
    onStoreEvent: OnStoreEventFn<EditMetadata, Delta, Presence>,
    {
      getRemote,
      networkSettings,
      remoteId = 'origin',
      localIdGenerator,
      addStoreMetadata,
    }: IndexedDbBackendOptions<EditMetadata, Delta, Presence>,
  ) {
    super(userId, clientId, onStoreEvent, getRemote, networkSettings);
    this.remoteId = remoteId;
    this.localIdGenerator = localIdGenerator;
    this.addStoreMetadata = addStoreMetadata;

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
    this.localStoreId = this.getRemoteSyncInfo().then(
      ({ localStoreId }) => localStoreId,
    );
  }

  protected broadcastLocal(
    event: BroadcastEvent<EditMetadata, Delta, Presence>,
  ): Promise<void> {
    return this.channel.postMessage(event).catch(this.handleAsError('network'));
  }

  protected async *getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, Presence>
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

  /**
   * Mutates commit and returns true if it did so
   */
  private updateCommitWithRemote(
    commit: TrimergeSyncDbCommit<EditMetadata, Delta> | undefined,
    metadata: EditMetadata | undefined,
    remoteSyncId: string | undefined,
  ): commit is TrimergeSyncDbCommit<EditMetadata, Delta> {
    if (commit && !commit.remoteSyncId && remoteSyncId) {
      commit.remoteSyncId = remoteSyncId;
      if (metadata !== undefined) {
        commit.metadata = metadata;
      }
      return true;
    }
    return false;
  }

  protected async acknowledgeRemoteCommits(
    acks: readonly CommitAck<EditMetadata>[],
    remoteSyncId: string,
  ): Promise<void> {
    const tx = (await this.db).transaction(['commits'], 'readwrite');
    const commits = tx.objectStore('commits');
    for (const { metadata, ref } of acks) {
      const commit = await commits.get(ref);
      if (this.updateCommitWithRemote(commit, metadata, remoteSyncId)) {
        await commits.put(commit);
      }
    }
    await this.upsertRemoteSyncInfo(remoteSyncId);
    await tx.done;
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
  ): Promise<IDBPDatabase<TrimergeSyncDbSchema<EditMetadata, Delta>>> {
    if (reconnect) {
      console.log(
        '[TRIMERGE-SYNC] IndexedDbBackend: reconnecting after 3 second timeout…',
      );
      await timeout(3_000);
    }
    const db = await createIndexedDb<EditMetadata, Delta>(this.dbName);
    db.onclose = () => {
      this.db = this.connect(true);
    };
    return db;
  }

  protected async addCommits(
    commits: readonly Commit<EditMetadata, Delta>[],
    remoteSyncId: string | undefined,
  ): Promise<AckCommitsEvent<EditMetadata>> {
    const db = await this.db;
    const tx = db.transaction(['heads', 'commits'], 'readwrite');

    const headsDb = tx.objectStore('heads');
    const commitsDb = tx.objectStore('commits');

    const [currentHeads, syncIdCursor] = await Promise.all([
      headsDb.getAllKeys(),
      // Gets the last item in the commits db based on the syncId index
      commitsDb.index('syncId').openCursor(undefined, 'prev'),
    ]);
    let nextCommitIndex = syncIdCursor?.value.syncId ?? 0;

    const priorHeads = new Set(currentHeads);
    const headsToDelete = new Set<string>();
    const headsToAdd = new Set<string>();
    const promises: Promise<unknown>[] = [];
    const refMetadata = new Map<string, EditMetadata>();
    const refErrors: AckRefErrors = {};

    const commitExistsAlready = async (
      commit: Commit<EditMetadata>,
    ): Promise<boolean> => {
      const existingCommit = await commitsDb.get(commit.ref);
      if (existingCommit) {
        if (
          this.updateCommitWithRemote(
            existingCommit,
            commit.metadata,
            remoteSyncId,
          )
        ) {
          refMetadata.set(commit.ref, commit.metadata);
          await commitsDb.put(existingCommit);
        } else {
          console.warn(`got duplicate local commit`, {
            commit,
            existingCommit,
          });
        }
        return true;
      }
      return false;
    };

    for (const commit of commits) {
      const commitIndex = ++nextCommitIndex;
      const { ref, baseRef } = commit;
      let mergeRef: string | undefined;
      if (isMergeCommit(commit)) {
        mergeRef = commit.mergeRef;
      }
      promises.push(
        (async () => {
          try {
            if (await commitExistsAlready(commit)) {
              return;
            }

            if (this.addStoreMetadata) {
              const localStoreId = await this.localStoreId;
              commit.metadata = this.addStoreMetadata(
                commit.metadata,
                localStoreId,
                commitIndex,
              );
            }
            await commitsDb.add({
              syncId: commitIndex,
              remoteSyncId: remoteSyncId ?? '',
              ...commit,
            });
            refMetadata.set(ref, commit.metadata);
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

    if (remoteSyncId) {
      await this.upsertRemoteSyncInfo(remoteSyncId);
    }

    await Promise.all(promises);
    await tx.done;

    return {
      type: 'ack',
      acks: Array.from(refMetadata, ([ref, metadata]) => ({ ref, metadata })),
      refErrors,
      syncId: toSyncId(nextCommitIndex),
    };
  }

  protected async *getLocalCommits(): AsyncIterableIterator<
    CommitsEvent<EditMetadata, Delta, Presence>
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

type TrimergeSyncDbCommit<EditMetadata, Delta> = Commit<EditMetadata, Delta> & {
  syncId: number;
  remoteSyncId: string;
};

interface TrimergeSyncDbSchema<EditMetadata, Delta> extends DBSchema {
  heads: {
    key: string;
    value: {
      ref: string;
    };
  };
  commits: {
    key: string;
    value: TrimergeSyncDbCommit<EditMetadata, Delta>;
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

function createIndexedDb<EditMetadata, Delta>(
  dbName: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema<EditMetadata, Delta>>> {
  return openDB(dbName, 2, {
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
