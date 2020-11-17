import {
  Differ,
  DiffNode,
  Snapshot,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
} from 'trimerge-sync';
import { DBSchema, IDBPDatabase, openDB } from 'idb';

let dbPromise: Promise<IDBPDatabase<TrimergeSyncDbSchema>> | undefined;

export class TrimergeIndexedDb<State, EditMetadata, Delta>
  implements TrimergeSyncStore<State, EditMetadata, Delta> {
  static async create<State, EditMetadata, Delta>(
    docId: string,
    differ: Differ<State, EditMetadata, Delta>,
    dbName: string = 'trimerge-sync-idb',
  ): Promise<TrimergeIndexedDb<State, EditMetadata, Delta>> {
    if (!dbPromise) {
      dbPromise = createIndexedDb(dbName);
    }
    const db = await dbPromise;
    return new TrimergeIndexedDb<State, EditMetadata, Delta>(docId, db, differ);
  }
  private constructor(
    private readonly docId: string,
    private readonly db: IDBPDatabase<TrimergeSyncDbSchema>,
    private readonly differ: Differ<State, EditMetadata, Delta>,
  ) {}

  async addNodes(
    newNodes: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<number> {
    const tx = this.db.transaction(['heads', 'nodes'], 'readwrite');

    // const docs = tx.objectStore(DOCS_STORE);
    const heads = tx.objectStore('heads');
    const nodes = tx.objectStore('nodes');

    const docId = this.docId;
    for (const node of newNodes) {
      nodes.add({ docId, ...node });
      if (node.baseRef !== undefined) {
        heads.delete([docId, node.baseRef]);
      }
      if (node.baseRef2 !== undefined) {
        heads.delete([docId, node.baseRef2]);
      }
      heads.add({ docId, ref: node.ref });
    }
    await tx.done;
    return 0;
  }

  async getSnapshot(): Promise<Snapshot<State, EditMetadata, Delta>> {
    const nodes = await this.db.getAllFromIndex('nodes', 'depth');
    return {
      node: undefined,
      nodes: nodes.filter(({ docId }) => docId === this.docId),
      syncCounter: 0,
    };
  }

  subscribe(
    lastSyncCounter: number,
    onNodes: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn {
    return () => {
      // does nothing
    };
  }

  close() {
    this.db.close();
  }
}

interface TrimergeSyncDbSchema extends DBSchema {
  docs: {
    key: [string];
    value: {
      docId: string;
    };
  };
  heads: {
    key: [string, string];
    value: {
      docId: string;
      ref: string;
    };
  };
  nodes: {
    key: [string, string];
    value: {
      docId: string;
    } & DiffNode<any, any, any>;
    indexes: {
      depth: [string, string];
    };
  };
}

function createIndexedDb(
  dbName: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
  return openDB<TrimergeSyncDbSchema>(dbName, 2, {
    upgrade(db, oldVersion, newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('docs', { keyPath: ['docId'] });
        db.createObjectStore('heads', { keyPath: ['docId', 'ref'] });
        db.createObjectStore('nodes', {
          keyPath: ['docId', 'ref'],
        });
      }
      if (oldVersion < 2) {
        tx.objectStore('nodes').createIndex('depth', ['docId', 'depth']);
      }
    },
  });
}
