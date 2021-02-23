import {
  BackendEvent,
  CursorRef,
  DiffNode,
  ErrorCode,
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
  private cursor: CursorRef<CursorState> = { ref: undefined, state: undefined };

  public constructor(
    private readonly docId: string,
    private readonly userId: string,
    private readonly cursorId: string,
    lastSyncId: string | undefined,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {
    const dbName = `trimerge-sync:${docId}`;
    console.log(`[TRIMERGE-SYNC] new IndexedDbBackend(${dbName})`);
    this.dbName = dbName;
    this.db = this.connect();
    this.channel = new BroadcastChannel(dbName, { webWorkerSupport: false });
    this.channel.addEventListener('message', (event) => {
      onEvent(event);
      if (event.type === 'cursor-join') {
        this.broadcast({
          type: 'cursors',
          cursors: [{ userId, cursorId, ...this.cursor }],
        });
      }
    });
    this.sendUserList().catch(this.handleAsError('internal'));
    this.sendNodesSince(toSyncNumber(lastSyncId)).catch(
      this.handleAsError('internal'),
    );
    window.addEventListener('beforeunload', this.close);
  }

  private handleAsError(code: ErrorCode) {
    return (error: Error) => {
      this.onEvent({
        type: 'error',
        code,
        message: error.message,
        fatal: true,
      });
      void this.close();
    };
  }
  private broadcast(event: BackendEvent<EditMetadata, Delta, CursorState>) {
    console.log('[TRIMERGE-SYNC] broadcasting event', event);
    return this.channel.postMessage(event);
  }
  private async sendUserList() {
    const { userId, cursorId } = this;
    this.onEvent({
      type: 'cursors',
      cursors: [{ userId, cursorId, ...this.cursor }],
    });
    await this.broadcast({
      type: 'cursor-join',
      userId,
      cursorId,
      ...this.cursor,
    });
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

  update(
    newNodes: DiffNode<EditMetadata, Delta>[],
    cursor: CursorRef<CursorState> | undefined,
  ) {
    this.doUpdate(newNodes, cursor).catch(this.handleAsError('invalid-nodes'));
  }

  private async doUpdate(
    nodes: DiffNode<EditMetadata, Delta>[],
    cursor: CursorRef<CursorState> | undefined,
  ): Promise<number> {
    if (cursor) {
      this.cursor = cursor;
    }
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
    if (promises.length > 0) {
      await Promise.all(promises);
      await tx.done;
    }

    const syncId = toSyncId(syncCounter);
    this.onEvent({
      type: 'ack',
      refs: nodes.map(({ ref }) => ref),
      syncId,
    });
    const cursors = cursor
      ? [
          {
            ...cursor,
            userId: this.userId,
            cursorId: this.cursorId,
          },
        ]
      : [];
    this.broadcast(
      nodes.length > 0
        ? {
            type: 'nodes',
            nodes,
            syncId,
            cursors,
          }
        : {
            type: 'cursors',
            cursors,
          },
    ).catch(this.handleAsError('internal'));

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
      cursors: [],
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
    await this.broadcast({
      type: 'cursor-leave',
      userId,
      cursorId,
    });
    await this.channel.close();
  }
  close = async (): Promise<void> => {
    console.log(`[TRIMERGE-SYNC] IndexedDbBackend(${this.dbName}): close`);
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
      state?: any;
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
