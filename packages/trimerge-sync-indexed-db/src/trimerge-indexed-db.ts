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
    docId: string,
    differ: Differ<State, EditMetadata, Delta>,
    dbName: string,
  ): Promise<TrimergeIndexedDb<State, EditMetadata, Delta>> {
    const db = await createIndexedDb(dbName);
    return new TrimergeIndexedDb<State, EditMetadata, Delta>(docId, db, differ);
  }
  constructor(
    private readonly docId: string,
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
      tx.oncomplete = () => resolve();

      // const docs = tx.objectStore(DOCS_STORE);
      const heads = tx.objectStore(HEADS_STORE);
      const nodes = tx.objectStore(NODES_STORE);

      const docId = this.docId;
      for (const node of newNodes) {
        nodes.add({ ...node, docId }, node.ref);
        if (node.baseRef !== undefined) {
          heads.delete(node.baseRef);
        }
        if (node.baseRef2 !== undefined) {
          heads.delete(node.baseRef2);
        }
        heads.add({ ref: node.ref, docId }, node.ref);
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore for some reason typescript doesn't define this
      tx.commit();
    });
  }

  getSnapshot(): Promise<Snapshot<State, EditMetadata>> {
    return Promise.reject(new Error('unsupported'));
  }

  subscribe(
    lastSyncCounter: number,
    onNodes: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn {
    throw new Error('unsupported');
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
