import {
  BackendEvent,
  DiffNode,
  GetSyncBackendFn,
  OnEventFn,
  TrimergeSyncBackend,
} from 'trimerge-sync';
import { DBSchema, IDBPDatabase, openDB, StoreValue } from 'idb';
import { BroadcastChannel } from 'broadcast-channel';

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

export function createIndexedDbBackendFactory<EditMetadata, Delta, CursorState>(
  docId: string,
): GetSyncBackendFn<EditMetadata, Delta, CursorState> {
  return (userId, cursorId, lastSyncId, onEvent) =>
    new IndexedDbBackend(docId, userId, cursorId, lastSyncId, onEvent);
}

class IndexedDbBackend<EditMetadata, Delta, CursorState>
  implements TrimergeSyncBackend<EditMetadata, Delta, CursorState> {
  private readonly dbName: string;
  private db: Promise<IDBPDatabase<TrimergeSyncDbSchema>>;
  private readonly channel: BroadcastChannel<
    BackendEvent<EditMetadata, Delta, CursorState>
  >;

  public constructor(
    private readonly docId: string,
    private readonly userId: string,
    private readonly cursorId: string,
    lastSyncId: string | undefined,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {
    const dbName = `trimerge-sync:${docId}`;
    this.dbName = dbName;
    this.db = this.connect();
    this.channel = new BroadcastChannel(dbName);
    this.channel.addEventListener('message', onEvent);
    this.sendUserList().catch(this.fail);
    this.sendNodesSince(toSyncNumber(lastSyncId)).catch(this.fail);
    window.addEventListener('beforeunload', this.close);
  }

  private fail = (error: Error) => {
    this.onEvent({
      type: 'error',
      code: 'internal',
      message: error.message,
      fatal: true,
    });
    void this.close();
  };
  private async sendUserList() {
    const { userId, cursorId } = this;
    const db = await this.db;
    const tx = db.transaction(['cursors'], 'readwrite');
    const cursors = tx.objectStore('cursors');
    await cursors.put({ userId, cursorId, state: undefined });
    const allCursors = await cursors.getAll();
    await tx.done;
    this.onEvent({
      type: 'cursors',
      cursors: allCursors,
    });
    await this.channel.postMessage({
      type: 'cursor-join',
      userId,
      cursorId,
      state: undefined,
    });
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

  sendNodes(newNodes: DiffNode<EditMetadata, Delta>[]) {
    this.addNodes(newNodes).catch((error) => {
      this.channel.postMessage({
        type: 'error',
        code: 'invalid-nodes',
        message: error.message,
      });
    });
  }

  private async addNodes(
    nodes: DiffNode<EditMetadata, Delta>[],
  ): Promise<number> {
    const db = await this.db;
    const tx = db.transaction(['heads', 'nodes'], 'readwrite');

    const headsDb = tx.objectStore('heads');
    const nodesDb = tx.objectStore('nodes');

    const [currentHeads, cursor] = await Promise.all([
      headsDb.getAllKeys(),
      nodesDb.index('syncId').openCursor(undefined, 'prev'),
    ]);
    let syncCounter = cursor?.value.syncId ?? 0;

    const priorHeads = new Set(currentHeads);
    const headsToDelete = new Set<string>();
    const headsToAdd = new Set<string>();
    const promises: Promise<unknown>[] = [];
    for (const node of nodes) {
      syncCounter++;
      promises.push(nodesDb.add({ syncId: syncCounter, ...node }));
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
        promises.push(headsDb.delete(ref));
      }
    }
    for (const ref of headsToAdd) {
      promises.push(headsDb.add({ ref }));
    }
    await Promise.all(promises);
    await tx.done;

    const syncId = toSyncId(syncCounter);
    this.onEvent({
      type: 'ack',
      refs: nodes.map(({ ref }) => ref),
      syncId,
    });
    this.channel
      .postMessage({
        type: 'nodes',
        nodes: nodes,
        syncId,
      })
      .catch(this.fail);
    return syncCounter;
  }

  private async sendNodesSince(lastSyncCounter: number) {
    const db = await this.db;
    const nodes = await db.getAllFromIndex(
      'nodes',
      'syncId',
      IDBKeyRange.lowerBound(lastSyncCounter, true),
    );
    const syncCounter = getSyncCounter(nodes);
    this.onEvent({
      type: 'nodes',
      nodes,
      syncId: toSyncId(syncCounter),
    });
  }

  private async closeDb() {
    const db = await this.db;
    const tx = db.transaction(['cursors'], 'readwrite');
    const cursors = tx.objectStore('cursors');
    await cursors.delete([this.userId, this.cursorId]);
    await tx.done;

    // To prevent reconnect
    db.onclose = null;
    db.close();
  }
  private async closeChannel() {
    const { userId, cursorId } = this;
    await this.channel.postMessage({
      type: 'cursor-leave',
      userId,
      cursorId,
    });
    await this.channel.close();
  }
  close = async (): Promise<void> => {
    window.removeEventListener('beforeunload', this.close);
    await Promise.all([this.closeChannel(), this.closeDb()]).catch((error) => {
      console.warn(`error closing IndexedDbBackend`, error);
    });
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
    value: { syncId: number } & DiffNode<any, any>;
    indexes: {
      syncId: number;
    };
  };
  cursors: {
    key: [string, string];
    value: {
      userId: string;
      cursorId: string;
      state: any;
    };
  };
}

function createIndexedDb(
  dbName: string,
): Promise<IDBPDatabase<TrimergeSyncDbSchema>> {
  return openDB<TrimergeSyncDbSchema>(dbName, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('heads', { keyPath: 'ref' });
        const nodes = db.createObjectStore('nodes', {
          keyPath: 'ref',
        });
        nodes.createIndex('syncId', 'syncId');
      }
      if (oldVersion < 2) {
        db.createObjectStore('cursors', { keyPath: ['userId', 'cursorId'] });
      }
    },
  });
}
