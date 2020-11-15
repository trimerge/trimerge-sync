import {
  DiffNode,
  Differ,
  Snapshot,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
} from 'trimerge-sync';

const DOCS_STORE = 'docs';
const HEADS_STORE = 'heads';
const NODES_STORE = 'nodes';

export class TrimergeIndexedDb<State, EditMetadata, Delta>
  implements TrimergeSyncStore<State, EditMetadata, Delta> {
  static async create<State, EditMetadata, Delta>(
    differ: Differ<State, EditMetadata, Delta>,
    dbName: string,
  ): Promise<TrimergeIndexedDb<State, EditMetadata, Delta>> {
    const db = await createIndexedDb(dbName);
    return new TrimergeIndexedDb<State, EditMetadata, Delta>(db, differ);
  }
  constructor(
    private readonly db: IDBDatabase,
    private readonly differ: Differ<State, EditMetadata, Delta>,
  ) {}

  addNodes(newNodes: DiffNode<State, EditMetadata, Delta>[]): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        [DOCS_STORE, HEADS_STORE, NODES_STORE],
        'readwrite',
      );
      tx.onerror = () => reject(tx.error || new Error('transaction error'));
      tx.onabort = () => reject(tx.error || new Error('transaction error'));

      const docs = tx.objectStore(DOCS_STORE);
      const heads = tx.objectStore(HEADS_STORE);
      const nodes = tx.objectStore(NODES_STORE);

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore for some reason typescript doesn't define this
      tx.commit();
    });
  }

  getSnapshot(): Promise<Snapshot<State, EditMetadata>> {
    return Promise.resolve(undefined);
  }

  subscribe(
    lastSyncCounter: number,
    onNodes: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn {
    return undefined;
  }

  close() {
    this.db.close();
  }
}

function createIndexedDb(dbName: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(dbName, 1);
    request.onblocked = () => {
      reject(request.error || new Error('database blocked'));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error || new Error('database error'));
    };
    request.onupgradeneeded = () => {
      const db = request.result;

      db.onerror = () => reject(request.error || new Error('database error'));

      db.createObjectStore(DOCS_STORE, { keyPath: ['docId'] });
      db.createObjectStore(NODES_STORE, { keyPath: ['docId', 'ref'] });
      db.createObjectStore(HEADS_STORE, { keyPath: ['docId', 'ref'] });

      resolve(db);
    };
  });
}
