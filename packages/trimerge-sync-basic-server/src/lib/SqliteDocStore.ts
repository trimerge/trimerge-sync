import SqliteDatabase, { Database } from 'better-sqlite3';
import { join } from 'path';
import {
  AckCommitsEvent,
  AckRefErrors,
  Commit,
  CommitsEvent,
  MergeCommit,
  isMergeCommit,
} from 'trimerge-sync';
import { unlink } from 'fs-extra';
import { DocStore } from '../DocStore';
import { asCommitRefs } from 'trimerge-sync/dist/lib/Commits';

type SqliteCommitType = {
  ref: string;
  remoteSyncId: string;
  remoteSyncIndex: number;
  userId: string;
  baseRef?: string;
  mergeRef?: string;
  delta?: string;
  metadata?: string;
};

interface ServerMetadata extends Record<string, unknown> {
  server?: {
    main: boolean;
    remoteSyncId: string;
    remoteSyncIndex: number;
  };
}

export class SqliteDocStore implements DocStore {
  private readonly db: Database;
  private readonly seenRefs = new Map<string, ServerMetadata | undefined>();
  private headRef: string | undefined = undefined;

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
        baseRef TEXT,
        mergeRef TEXT,
        delta TEXT,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS remoteSyncIdIndex ON commits (remoteSyncId, remoteSyncIndex);
`);
    const stmt = this.db.prepare(
      `SELECT ref FROM commits ORDER BY remoteSyncId, remoteSyncIndex`,
    );
    const sqliteCommits: Pick<SqliteCommitType, 'ref' | 'metadata'>[] =
      stmt.all();
    this.seenRefs = new Map(
      sqliteCommits.map(({ ref, metadata }) => [
        ref,
        metadata ? JSON.parse(metadata) : undefined,
      ]),
    );
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
    const commits = sqliteCommits.map((commit): Commit => {
      const { ref, remoteSyncId, baseRef, mergeRef, delta, metadata } = commit;

      if (remoteSyncId) {
        syncId = remoteSyncId;
      }

      if (mergeRef) {
        return {
          ref,
          baseRef,
          mergeRef,
          delta,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        };
      } else {
        return {
          ref,
          baseRef: baseRef || undefined,
          delta,
          metadata: metadata ? JSON.parse(metadata) : undefined,
        };
      }
    });
    return {
      type: 'commits',
      commits,
      syncId,
    };
  }

  add(commits: readonly Commit<ServerMetadata, unknown>[]): AckCommitsEvent {
    const remoteSyncId = this.syncIdCreator();
    const insert = this.db.prepare(
      `
        INSERT INTO commits (ref, remoteSyncId, remoteSyncIndex, userId, baseRef, mergeRef, delta, metadata) 
        VALUES (@ref, @remoteSyncId, @remoteSyncIndex, @userId, @baseRef, @mergeRef, @delta, @metadata)
        ON CONFLICT DO NOTHING`,
    );
    const acks = new Map<string, ServerMetadata | undefined>();
    const refErrors: AckRefErrors = {};
    const invalidParentRef = (commit: Commit, key: 'baseRef' | 'mergeRef') => {
      // slightly unsafe type cast here but mergeRef should just be undefined for EditCommits
      const parentRef = (commit as MergeCommit)[key];
      if (parentRef && !this.seenRefs.has(parentRef)) {
        refErrors[commit.ref] = {
          code: 'unknown-ref',
          message: `unknown ${key}`,
        };
        return true;
      }
      return false;
    };

    const computeIsMain = (commit: Commit<ServerMetadata, unknown>) => {
      if (isMergeCommit(commit)) {
        return (
          commit.mergeRef === this.headRef || commit.baseRef === this.headRef
        );
      } else {
        return commit.baseRef === this.headRef;
      }
    };

    this.db.transaction(() => {
      let remoteSyncIndex = 0;
      for (const commit of commits) {
        const { ref, baseRef, mergeRef } = asCommitRefs(commit);
        const { delta } = commit;
        let { metadata } = commit;

        if (
          invalidParentRef(commit, 'baseRef') ||
          invalidParentRef(commit, 'mergeRef')
        ) {
          continue;
        }
        if (this.seenRefs.has(ref)) {
          acks.set(ref, this.seenRefs.get(ref));
          continue;
        }
        try {
          let isMain = false;
          if (computeIsMain(commit)) {
            isMain = true;
            this.headRef = commit.ref;
          }

          metadata = {
            ...metadata,
            server: {
              main: isMain,
              remoteSyncIndex,
              remoteSyncId,
            },
          };

          const { changes } = insert.run({
            ref,
            baseRef,
            mergeRef,
            delta,
            metadata: JSON.stringify(metadata),
            remoteSyncId,
            remoteSyncIndex,
          });
          if (changes !== 1) {
            throw new Error(`inserted changes unexpectedly ${changes}`);
          }
          acks.set(ref, metadata);
          this.seenRefs.set(ref, metadata);
          remoteSyncIndex++;
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
      acks: Array.from(acks, ([ref, metadata]) => ({ ref, metadata })),
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
