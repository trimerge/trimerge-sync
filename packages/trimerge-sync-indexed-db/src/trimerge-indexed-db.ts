import {
  Differ,
  DiffNode,
  Snapshot,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
} from 'trimerge-sync';
import { DBSchema, IDBPDatabase, openDB, StoreValue } from 'idb';

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

export class TrimergeIndexedDb<State, EditMetadata, Delta>
  implements TrimergeSyncStore<State, EditMetadata, Delta> {
  static async create<State, EditMetadata, Delta>(
    docId: string,
    differ: Differ<State, EditMetadata, Delta>,
  ): Promise<TrimergeIndexedDb<State, EditMetadata, Delta>> {
    const dbName = `trimerge-sync:${docId}`;
    const db = await createIndexedDb(dbName);
    return new TrimergeIndexedDb<State, EditMetadata, Delta>(
      dbName,
      db,
      differ,
    );
  }

  private readonly listeners = new Map<
    SyncSubscriber<State, EditMetadata, Delta>,
    number
  >();

  private constructor(
    private readonly dbName: string,
    private readonly db: IDBPDatabase<TrimergeSyncDbSchema>,
    private readonly differ: Differ<State, EditMetadata, Delta>,
  ) {
    window.addEventListener('storage', (event) => {
      if (event.key === dbName) {
        for (const [listener, lastSyncCounter] of this.listeners.entries()) {
          void this.sendNodesSince(listener, lastSyncCounter);
        }
      }
    });
  }

  async addNodes(
    newNodes: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<number> {
    const tx = this.db.transaction(['heads', 'nodes'], 'readwrite');

    // const docs = tx.objectStore(DOCS_STORE);
    const heads = tx.objectStore('heads');
    const nodes = tx.objectStore('nodes');

    const cursor = await nodes.index('syncId').openCursor(undefined, 'prev');
    let syncId = cursor?.value.syncId ?? 0;

    for (const node of newNodes) {
      syncId++;
      await nodes.add({ syncId, ...node });
      if (node.baseRef !== undefined) {
        await heads.delete(node.baseRef);
      }
      if (node.baseRef2 !== undefined) {
        await heads.delete(node.baseRef2);
      }
      heads.add({ ref: node.ref });
    }
    await tx.done;

    window.localStorage.setItem(this.dbName, String(syncId));
    return syncId;
  }

  async getSnapshot(): Promise<Snapshot<State, EditMetadata, Delta>> {
    const nodes = await this.db.getAllFromIndex('nodes', 'syncId');
    return { nodes, syncCounter: getSyncCounter(nodes) };
  }

  private async sendNodesSince(
    onNodes: SyncSubscriber<State, EditMetadata, Delta>,
    lastSyncCounter: number,
  ) {
    const newNodes = await this.db.getAllFromIndex(
      'nodes',
      'syncId',
      IDBKeyRange.lowerBound(lastSyncCounter, true),
    );
    console.log('newNodes', newNodes);
    const syncCounter = getSyncCounter(newNodes);
    onNodes({ newNodes, syncCounter });
    this.listeners.set(onNodes, syncCounter);
  }

  subscribe(
    lastSyncCounter: number,
    onNodes: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn {
    this.listeners.set(onNodes, lastSyncCounter);
    void this.sendNodesSince(onNodes, lastSyncCounter);
    return () => {
      this.listeners.delete(onNodes);
    };
  }

  close() {
    this.db.close();
  }
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
    value: { syncId: number } & DiffNode<any, any, any>;
    indexes: {
      syncId: number;
    };
  };
}

function createIndexedDb(
  dbName: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
  return openDB<TrimergeSyncDbSchema>(dbName, 1, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('heads', { keyPath: 'ref' });
        const nodes = db.createObjectStore('nodes', {
          keyPath: 'ref',
        });
        nodes.createIndex('syncId', 'syncId');
      }
    },
  });
}
