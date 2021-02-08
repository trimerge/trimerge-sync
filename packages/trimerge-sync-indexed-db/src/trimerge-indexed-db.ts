import {
  DiffNode,
  GetSyncBackendFn,
  OnEventFn,
  TrimergeSyncBackend,
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

export function createIndexedDbBackendFactory<EditMetadata, Delta, CursorData>(
  docId: string,
): GetSyncBackendFn<EditMetadata, Delta, CursorData> {
  return (userId, cursorId, lastSyncId, onEvent) => {
    const db = new TrimergeIndexedDb(docId);
    return {
      sendNodes(nodes: DiffNode<EditMetadata, Delta>[]): void {
        db.addNodes(nodes);
      },
      close() {
        return db.close();
      },
    };
  };
}

class TrimergeIndexedDb<EditMetadata, Delta, CursorData> {
  private readonly dbName: string;
  private db: Promise<IDBPDatabase<TrimergeSyncDbSchema>>;
  private readonly listeners = new Map<
    OnEventFn<EditMetadata, Delta, CursorData>,
    number
  >();
  private readonly channel: BroadcastChannel | undefined;

  public constructor(private readonly docId: string) {
    const dbName = `trimerge-sync:${docId}`;
    this.dbName = dbName;
    this.db = this.connect();

    if (typeof window.BroadcastChannel !== 'undefined') {
      console.log(`[trimerge-sync] Using BroadcastChannel for ${dbName}`);
      this.channel = new window.BroadcastChannel(dbName);
      this.channel.onmessage = (event) => {
        const syncData: OnEventFn<EditMetadata, Delta, CursorData> = event.data;
        for (const listener of this.listeners.keys()) {
          this.listeners.set(listener, syncData.syncCounter);
          listener(syncData);
        }
      };
    } else if (typeof window.localStorage !== 'undefined') {
      console.log(`[trimerge-sync] Using LocalStorage for ${dbName}`);
      window.addEventListener('storage', (event) => {
        if (event.key === dbName) {
          for (const [listener, lastSyncCounter] of this.listeners.entries()) {
            void this.sendNodesSince(listener, lastSyncCounter);
          }
        }
      });
    } else {
      // TODO: fall back on some kind of polling?
      throw new Error('BroadcastChannel and localStorage unavailable');
    }
  }
  private async connect(
    reconnect: boolean = false,
  ): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
    if (reconnect) {
      console.log('Reconnecting after 3 second timeout…');
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    const db = await createIndexedDb(this.dbName);
    db.onclose = () => {
      this.db = this.connect(true);
    };
    return db;
  }

  async addNodes(newNodes: DiffNode<EditMetadata, Delta>[]): Promise<number> {
    const db = await this.db;
    const tx = db.transaction(['heads', 'nodes'], 'readwrite');

    const heads = tx.objectStore('heads');
    const nodes = tx.objectStore('nodes');

    const [currentHeads, cursor] = await Promise.all([
      heads.getAllKeys(),
      nodes.index('syncId').openCursor(undefined, 'prev'),
    ]);
    let syncId = cursor?.value.syncId ?? 0;

    const priorHeads = new Set(currentHeads);
    const headsToDelete = new Set<string>();
    const headsToAdd = new Set<string>();
    const promises: Promise<unknown>[] = [];
    for (const node of newNodes) {
      syncId++;
      promises.push(nodes.add({ syncId, ...node }));
      const { ref, baseRef, mergeRef } = node;
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
        promises.push(heads.delete(ref));
      }
    }
    for (const ref of headsToAdd) {
      promises.push(heads.add({ ref }));
    }
    await Promise.all(promises);
    await tx.done;

    if (this.channel) {
      this.channel.postMessage({ newNodes, syncCounter: syncId });
    } else {
      window.localStorage.setItem(this.dbName, String(syncId));
    }
    return syncId;
  }

  private async sendNodesSince(
    onNodes: OnEventFn<EditMetadata, Delta, CursorData>,
    lastSyncCounter: number,
  ) {
    const db = await this.db;
    const newNodes = await db.getAllFromIndex(
      'nodes',
      'syncId',
      IDBKeyRange.lowerBound(lastSyncCounter, true),
    );
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
    this.channel?.close();
    return this.db.then((db) => {
      // To prevent reconnect
      db.onclose = null;
      db.close();
    });
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
    value: { syncId: number } & DiffNode<any, any>;
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
