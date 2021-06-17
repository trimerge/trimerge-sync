import SqliteDatabase, { Database } from 'better-sqlite3';
import { join } from 'path';
import type {
  AckNodesEvent,
  AckRefErrors,
  DiffNode,
  NodesEvent,
} from 'trimerge-sync';
import { unlink } from 'fs-extra';
import { DocStore } from '../DocStore';

type SqliteNodeType = {
  ref: string;
  remoteSyncId: string;
  remoteSyncIndex: number;
  userId: string;
  clientId: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
  delta?: string;
  editMetadata?: string;
};

export class SqliteDocStore implements DocStore {
  private readonly db: Database;
  private readonly seenRefs = new Set<string>();

  constructor(
    docId: string,
    baseDir: string,
    private readonly syncIdCreator = () => new Date().toISOString(),
  ) {
    this.db = new SqliteDatabase(join(baseDir, docId + '.sqlite'));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        ref TEXT PRIMARY KEY NOT NULL,
        remoteSyncId TEXT NOT NULL,
        remoteSyncIndex INTEGER NOT NULL,
        userId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        baseRef TEXT,
        mergeRef TEXT,
        mergeBaseRef TEXT,
        delta TEXT,
        editMetadata TEXT
      );
      CREATE INDEX IF NOT EXISTS remoteSyncIdIndex ON nodes (remoteSyncId, remoteSyncIndex);
`);
    const stmt = this.db.prepare(
      `SELECT ref FROM nodes ORDER BY remoteSyncId, remoteSyncIndex`,
    );
    const sqliteNodes: Pick<SqliteNodeType, 'ref'>[] = stmt.all();
    this.seenRefs = new Set(sqliteNodes.map(({ ref }) => ref));
  }

  getNodesEvent(lastSyncId?: string): NodesEvent<unknown, unknown, unknown> {
    const stmt =
      lastSyncId === undefined
        ? this.db.prepare(
            `SELECT * FROM nodes ORDER BY remoteSyncId, remoteSyncIndex`,
          )
        : this.db.prepare(
            `SELECT * FROM nodes WHERE remoteSyncId > @lastSyncId ORDER BY remoteSyncId, remoteSyncIndex`,
          );

    const sqliteNodes: SqliteNodeType[] = stmt.all({ lastSyncId });
    let syncId = '';
    const nodes = sqliteNodes.map(
      ({
        ref,
        remoteSyncId,
        userId,
        clientId,
        baseRef,
        mergeRef,
        mergeBaseRef,
        delta,
        editMetadata,
      }): DiffNode<unknown, unknown> => {
        if (remoteSyncId) {
          syncId = remoteSyncId;
        }
        return {
          ref,
          remoteSyncId,
          userId,
          clientId,
          baseRef: baseRef || undefined,
          mergeRef: mergeRef || undefined,
          mergeBaseRef: mergeBaseRef || undefined,
          delta: delta ? JSON.parse(delta) : undefined,
          editMetadata: editMetadata ? JSON.parse(editMetadata) : undefined,
        };
      },
    );
    return {
      type: 'nodes',
      nodes,
      syncId: syncId,
    };
  }

  add(nodes: readonly DiffNode<unknown, unknown>[]): AckNodesEvent {
    const remoteSyncId = this.syncIdCreator();
    const insert = this.db.prepare(
      `
        INSERT INTO nodes (ref, remoteSyncId, remoteSyncIndex, userId, clientId, baseRef, mergeRef, mergeBaseRef, delta, editMetadata) 
        VALUES (@ref, @remoteSyncId, @remoteSyncIndex, @userId, @clientId, @baseRef, @mergeRef, @mergeBaseRef, @delta, @editMetadata)
        ON CONFLICT DO NOTHING`,
    );
    const seenRefs = new Set(this.seenRefs);
    for (const { ref } of nodes) {
      seenRefs.add(ref);
    }
    const refs: string[] = [];
    const refErrors: AckRefErrors = {};
    function invalidParentRef(
      node: DiffNode<unknown, unknown>,
      key: keyof Pick<
        DiffNode<unknown, unknown>,
        'baseRef' | 'mergeRef' | 'mergeBaseRef'
      >,
    ) {
      const parentRef = node[key];
      if (parentRef && !seenRefs.has(parentRef)) {
        refErrors[node.ref] = {
          code: 'invalid-node',
          message: `unknown ${parentRef}`,
        };
        return true;
      }
      return false;
    }
    this.db.transaction(() => {
      let remoteSyncIndex = 0;
      for (const node of nodes) {
        const {
          userId,
          clientId,
          ref,
          baseRef,
          mergeBaseRef,
          mergeRef,
          delta,
          editMetadata,
        } = node;
        if (
          invalidParentRef(node, 'baseRef') ||
          invalidParentRef(node, 'mergeRef') ||
          invalidParentRef(node, 'mergeBaseRef')
        ) {
          continue;
        }
        refs.push(ref);
        if (seenRefs.has(ref)) {
          continue;
        }
        insert.run({
          userId,
          clientId,
          ref,
          baseRef,
          mergeBaseRef,
          mergeRef,
          delta: JSON.stringify(delta),
          editMetadata: JSON.stringify(editMetadata),
          remoteSyncId,
          remoteSyncIndex,
        });
        remoteSyncIndex++;
        this.seenRefs.add(ref);
      }
    })();
    return {
      type: 'ack',
      refs,
      syncId: remoteSyncId,
    };
  }

  async delete() {
    this.close();
    await unlink(this.db.name);
  }

  close() {
    this.db.close();
  }
}
