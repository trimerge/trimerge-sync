import SqliteDatabase, { Database } from 'better-sqlite3';
import { join } from 'path';
import type {
  AckCommitsEvent,
  AckRefErrors,
  Commit,
  CommitsEvent,
} from 'trimerge-sync';
import { unlink } from 'fs-extra';
import { DocStore } from '../DocStore';

type SqliteCommitType = {
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
      CREATE TABLE IF NOT EXISTS commits (
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
      CREATE INDEX IF NOT EXISTS remoteSyncIdIndex ON commits (remoteSyncId, remoteSyncIndex);
`);
    const stmt = this.db.prepare(
      `SELECT ref FROM commits ORDER BY remoteSyncId, remoteSyncIndex`,
    );
    const sqliteCommits: Pick<SqliteCommitType, 'ref'>[] = stmt.all();
    this.seenRefs = new Set(sqliteCommits.map(({ ref }) => ref));
  }

  getCommitsEvent(
    lastSyncId?: string,
  ): CommitsEvent<unknown, unknown, unknown> {
    const stmt =
      lastSyncId === undefined
        ? this.db.prepare(
            `SELECT * FROM commits ORDER BY remoteSyncId, remoteSyncIndex`,
          )
        : this.db.prepare(
            `SELECT * FROM commits WHERE remoteSyncId > @lastSyncId ORDER BY remoteSyncId, remoteSyncIndex`,
          );

    const sqliteCommits: SqliteCommitType[] = stmt.all({ lastSyncId });
    let syncId = '';
    const commits = sqliteCommits.map(
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
      }): Commit<unknown, unknown> => {
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
      type: 'commits',
      commits,
      syncId: syncId,
    };
  }

  add(commits: readonly Commit<unknown, unknown>[]): AckCommitsEvent {
    const remoteSyncId = this.syncIdCreator();
    const insert = this.db.prepare(
      `
        INSERT INTO commits (ref, remoteSyncId, remoteSyncIndex, userId, clientId, baseRef, mergeRef, mergeBaseRef, delta, editMetadata) 
        VALUES (@ref, @remoteSyncId, @remoteSyncIndex, @userId, @clientId, @baseRef, @mergeRef, @mergeBaseRef, @delta, @editMetadata)
        ON CONFLICT DO NOTHING`,
    );
    const refs = new Set<string>();
    const refErrors: AckRefErrors = {};
    const invalidParentRef = (
      commit: Commit<unknown, unknown>,
      key: 'baseRef' | 'mergeRef' | 'mergeBaseRef',
    ) => {
      const parentRef = commit[key];
      if (parentRef && !this.seenRefs.has(parentRef)) {
        refErrors[commit.ref] = {
          code: 'unknown-ref',
          message: `unknown ${key}`,
        };
        return true;
      }
      return false;
    };
    this.db.transaction(() => {
      let remoteSyncIndex = 0;
      for (const commit of commits) {
        const {
          userId,
          clientId,
          ref,
          baseRef,
          mergeBaseRef,
          mergeRef,
          delta,
          editMetadata,
        } = commit;
        if (
          invalidParentRef(commit, 'baseRef') ||
          invalidParentRef(commit, 'mergeRef') ||
          invalidParentRef(commit, 'mergeBaseRef')
        ) {
          continue;
        }
        if (this.seenRefs.has(ref)) {
          refs.add(ref);
          continue;
        }
        try {
          const { changes } = insert.run({
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
          if (changes !== 1) {
            throw new Error(`inserted changes unexpectedly ${changes}`);
          }
          refs.add(ref);
          remoteSyncIndex++;
          this.seenRefs.add(ref);
        } catch (error) {
          refErrors[commit.ref] = {
            code: 'storage-failure',
            message: String(error),
          };
        }
      }
    })();
    return {
      type: 'ack',
      refs: Array.from(refs),
      refErrors,
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
