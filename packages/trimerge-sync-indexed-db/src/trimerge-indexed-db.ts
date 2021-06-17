import {
  AbstractLocalStore,
  SyncEvent,
  DiffNode,
  GetLocalStoreFn,
  GetRemoteFn,
  NodesEvent,
  OnEventFn,
  AckNodesEvent,
  AckRefErrors,
} from 'trimerge-sync';
import { DBSchema, deleteDB, IDBPDatabase, openDB, StoreValue } from 'idb';
import {
  BroadcastChannel,
  createLeaderElection,
  LeaderElector,
} from 'broadcast-channel';

function getSyncCounter(
  nodes: StoreValue<TrimergeSyncDbSchema, 'nodes'>[],
): number {
  let syncCounter = 0;
  for (const node of nodes) {
    if (syncCounter < node.syncId) {
      syncCounter = node.syncId;
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

export function createIndexedDbBackendFactory<
  EditMetadata,
  Delta,
  PresenceState
>(
  docId: string,
  getRemote?: GetRemoteFn<EditMetadata, Delta, PresenceState>,
): GetLocalStoreFn<EditMetadata, Delta, PresenceState> {
  return (userId, clientId, onEvent) =>
    new IndexedDbBackend(docId, userId, clientId, onEvent, getRemote);
}

function getDatabaseName(docId: string): string {
  return `trimerge-sync:${docId}`;
}

export function deleteDocDatabase(docId: string): Promise<void> {
  return deleteDB(getDatabaseName(docId));
}

class IndexedDbBackend<
  EditMetadata,
  Delta,
  PresenceState
> extends AbstractLocalStore<EditMetadata, Delta, PresenceState> {
  private readonly dbName: string;
  private db: Promise<IDBPDatabase<TrimergeSyncDbSchema>>;
  private readonly channel: BroadcastChannel<
    SyncEvent<EditMetadata, Delta, PresenceState>
  >;
  private readonly leaderElector: LeaderElector | undefined;

  public constructor(
    private readonly docId: string,
    userId: string,
    clientId: string,
    onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    getRemote?: GetRemoteFn<EditMetadata, Delta, PresenceState>,
    private readonly remoteId: string = 'origin',
  ) {
    super(userId, clientId, onEvent);
    const dbName = getDatabaseName(docId);
    console.log(`[TRIMERGE-SYNC] new IndexedDbBackend(${dbName})`);
    this.dbName = dbName;
    this.db = this.connect();
    this.channel = new BroadcastChannel(dbName, { webWorkerSupport: false });
    this.channel.addEventListener('message', this.onLocalBroadcastEvent);
    if (getRemote) {
      this.leaderElector = createLeaderElection(this.channel);
      this.leaderElector
        .awaitLeadership()
        .then(() => this.connectRemote(getRemote))
        .catch(this.handleAsError('internal'));
    }
    this.sendInitialEvents().catch(this.handleAsError('internal'));
    window.addEventListener('beforeunload', this.shutdown);
  }

  protected broadcastLocal(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    return this.channel.postMessage(event).catch(this.handleAsError('network'));
  }

  protected async *getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    const db = await this.db;
    const unsentNodes = await db.getAllFromIndex('nodes', 'remoteSyncId', '');
    if (unsentNodes.length > 0) {
      yield {
        type: 'nodes',
        nodes: unsentNodes,
        syncId: '',
      };
    }
  }

  protected async acknowledgeRemoteNodes(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void> {
    const db = await this.db;
    for (const ref of refs) {
      const node = await db.get('nodes', ref);
      if (node && !node.remoteSyncId) {
        node.remoteSyncId = remoteSyncId;
        await db.put('nodes', node);
      }
    }
    await this.updateLastRemoteSyncId(remoteSyncId);
  }

  protected async getLastRemoteSyncId(): Promise<string | undefined> {
    const db = await this.db;
    const remote = await db.get('remotes', this.remoteId);
    const lastSyncId = remote?.lastSyncId;
    if (lastSyncId) {
      return String(lastSyncId);
    }
    return undefined;
  }

  protected async updateLastRemoteSyncId(lastSyncId: string): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['remotes'], 'readwrite');
    const remotes = tx.objectStore('remotes');
    const remote = (await remotes.get(this.remoteId)) ?? {};
    remote.lastSyncId = lastSyncId;
    await remotes.put(remote, this.remoteId);
    await tx.done;
  }

  private async connect(
    reconnect: boolean = false,
  ): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
    if (reconnect) {
      console.log(
        '[TRIMERGE-SYNC] IndexedDbBackend: reconnecting after 3 second timeout…',
      );
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    const db = await createIndexedDb(this.dbName);
    db.onclose = () => {
      this.db = this.connect(true);
    };
    return db;
  }

  protected async addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
    lastSyncId: string | undefined,
  ): Promise<AckNodesEvent> {
    const db = await this.db;
    const tx = db.transaction(['heads', 'nodes'], 'readwrite');

    const headsDb = tx.objectStore('heads');
    const nodesDb = tx.objectStore('nodes');

    const [currentHeads, syncIdCursor] = await Promise.all([
      headsDb.getAllKeys(),
      // Gets the last item in the nodes db based on the syncId index
      nodesDb.index('syncId').openCursor(undefined, 'prev'),
    ]);
    let syncCounter = syncIdCursor?.value.syncId ?? 0;

    const priorHeads = new Set(currentHeads);
    const headsToDelete = new Set<string>();
    const headsToAdd = new Set<string>();
    const promises: Promise<unknown>[] = [];
    const refs = new Set<string>();
    const refErrors: AckRefErrors = {};
    async function nodeExistsAlready(
      node: DiffNode<unknown, unknown>,
      error?: string,
    ): Promise<boolean> {
      const existingNode = await nodesDb.get(node.ref);
      if (existingNode) {
        refs.add(node.ref);
        console.warn(`already have node`, { node, existingNode, error });
        return true;
      }
      return false;
    }

    for (const node of nodes) {
      const syncId = ++syncCounter;
      const { ref, baseRef, mergeRef } = node;
      promises.push(
        (async () => {
          if (await nodeExistsAlready(node)) {
            return;
          }
          try {
            await nodesDb.add({
              syncId,
              remoteSyncId: '',
              ...node,
            });
            refs.add(ref);
          } catch (e) {
            // Check again (I'm not sure why the first check fails sometimes)
            if (await nodeExistsAlready(node, e.message)) {
              return;
            }
            refErrors[ref] = { code: 'internal', message: e.message };
            console.warn(`error inserting node`, { node }, e);
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
      promises.push(headsDb.add({ ref }));
    }

    if (lastSyncId) {
      await this.updateLastRemoteSyncId(lastSyncId);
    }
    if (promises.length > 0) {
      await Promise.all(promises);
      await tx.done;
    }

    return {
      type: 'ack',
      refs: Array.from(refs),
      refErrors,
      syncId: toSyncId(syncCounter),
    };
  }

  protected async *getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    const lastSyncCounter = toSyncNumber(undefined);
    const db = await this.db;
    const nodes = await db.getAllFromIndex(
      'nodes',
      'syncId',
      IDBKeyRange.lowerBound(lastSyncCounter, true),
    );
    const syncCounter = getSyncCounter(nodes);
    yield {
      type: 'nodes',
      nodes,
      syncId: toSyncId(syncCounter),
    };
  }

  async deleteDatabase() {
    await this.shutdown();
    await deleteDB(this.dbName);
  }

  shutdown = async (): Promise<void> => {
    await super.shutdown();
    window.removeEventListener('beforeunload', this.shutdown);
    await this.leaderElector?.die();
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
  nodes: {
    key: string;
    value: DiffNode<any, any> & {
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
      lastSyncId?: string;
    };
  };
}

function createIndexedDb(
  dbName: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
  return openDB<TrimergeSyncDbSchema>(dbName, 2, {
    upgrade(db, oldVersion, newVersion, tx) {
      let nodes;
      if (oldVersion < 1) {
        db.createObjectStore('heads', { keyPath: 'ref' });
        nodes = db.createObjectStore('nodes', { keyPath: 'ref' });
        nodes.createIndex('syncId', 'syncId');
      } else {
        nodes = tx.objectStore('nodes');
      }
      if (oldVersion < 2) {
        db.createObjectStore('remotes');
        nodes.createIndex('remoteSyncId', 'remoteSyncId');
      }
    },
  });
}
