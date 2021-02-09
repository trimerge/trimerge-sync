import {
  DiffNode,
  GetSyncBackendFn,
  NodesEvent,
  OnEventFn,
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

function toSyncId(syncNumber: number): string {
  return syncNumber.toString(36);
}
function toSyncNumber(syncId: string | undefined): number {
  return syncId === undefined ? 0 : parseInt(syncId, 36);
}

type UnsubscribeFn = () => void;

export function createIndexedDbBackendFactory<EditMetadata, Delta, CursorData>(
  docId: string,
): GetSyncBackendFn<EditMetadata, Delta, CursorData> {
  return (userId, cursorId, lastSyncId, onEvent) => {
    const db = new TrimergeIndexedDb<EditMetadata, Delta, CursorData>(docId);
    db.subscribe(toSyncNumber(lastSyncId), onEvent);
    return {
      sendNodes(nodes: DiffNode<EditMetadata, Delta>[]): void {
        db.addNodes(nodes)
          .then((syncCounter) => {
            onEvent({
              type: 'ack',
              refs: nodes.map(({ ref }) => ref),
              syncId: toSyncId(syncCounter),
            });
          })
          .catch((e) => {
            onEvent({
              type: 'error',
              code: 'invalid-nodes',
              message: e.message,
            });
          });
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
  private readonly onEventListeners = new Map<
    OnEventFn<EditMetadata, Delta, CursorData>,
    number
  >();
  private readonly channel: BroadcastChannel | undefined;

  private readonly broadcastNodesEvent: (
    nodes: NodesEvent<EditMetadata, Delta>,
  ) => void;

  public constructor(private readonly docId: string) {
    const dbName = `trimerge-sync:${docId}`;
    this.dbName = dbName;
    this.db = this.connect();

    if (typeof window.BroadcastChannel !== 'undefined') {
      console.log(`[trimerge-sync] Using BroadcastChannel for ${dbName}`);
      const channel = new window.BroadcastChannel(dbName);
      channel.onmessage = (event) => {
        const nodes: NodesEvent<EditMetadata, Delta> = event.data;
        const syncCounter = toSyncNumber(nodes.syncId);
        for (const onEvent of this.onEventListeners.keys()) {
          this.onEventListeners.set(onEvent, syncCounter);
          onEvent(nodes);
        }
      };
      this.broadcastNodesEvent = (newNodes) => {
        channel.postMessage(newNodes);
      };
      this.channel = channel;
    } else if (typeof window.localStorage !== 'undefined') {
      console.log(`[trimerge-sync] Using LocalStorage for ${dbName}`);
      window.addEventListener('storage', (event) => {
        if (event.key === dbName) {
          for (const [
            listener,
            lastSyncCounter,
          ] of this.onEventListeners.entries()) {
            void this.sendNodesSince(listener, lastSyncCounter);
          }
        }
      });
      this.broadcastNodesEvent = ({ syncId }) => {
        window.localStorage.setItem(this.dbName, syncId);
      };
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
    let syncCounter = cursor?.value.syncId ?? 0;

    const priorHeads = new Set(currentHeads);
    const headsToDelete = new Set<string>();
    const headsToAdd = new Set<string>();
    const promises: Promise<unknown>[] = [];
    for (const node of newNodes) {
      syncCounter++;
      promises.push(nodes.add({ syncId: syncCounter, ...node }));
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

    this.broadcastNodesEvent({
      type: 'nodes',
      nodes: newNodes,
      syncId: toSyncId(syncCounter),
    });
    return syncCounter;
  }

  private async sendNodesSince(
    onEvent: OnEventFn<EditMetadata, Delta, CursorData>,
    lastSyncCounter: number,
  ) {
    const db = await this.db;
    const nodes = await db.getAllFromIndex(
      'nodes',
      'syncId',
      IDBKeyRange.lowerBound(lastSyncCounter, true),
    );
    const syncCounter = getSyncCounter(nodes);
    onEvent({
      type: 'nodes',
      nodes,
      syncId: toSyncId(syncCounter),
    });
    this.onEventListeners.set(onEvent, syncCounter);
  }

  subscribe(
    lastSyncCounter: number,
    onNodes: OnEventFn<EditMetadata, Delta, CursorData>,
  ): UnsubscribeFn {
    this.onEventListeners.set(onNodes, lastSyncCounter);
    void this.sendNodesSince(onNodes, lastSyncCounter);
    return () => {
      this.onEventListeners.delete(onNodes);
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
