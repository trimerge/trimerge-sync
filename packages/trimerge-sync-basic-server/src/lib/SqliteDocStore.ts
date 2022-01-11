import SqliteDatabase, { Database } from 'better-sqlite3';
import { join } from 'path';
import {
  AckCommitsEvent,
  AckRefErrors,
  Commit,
  CommitsEvent,
  MergeCommit,
  ServerCommit,
  isMergeCommit,
} from 'trimerge-sync';
import { unlink } from 'fs-extra';
import { DocStore } from '../DocStore';

type SqliteCommitType = {
  ref: string;
  remoteSyncId: string;
  remoteSyncIndex: number;
  userId: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
  delta?: string;
  metadata?: string;

  // Indicates whether this commit is on the "mainline"
  main: boolean;
};

export class SqliteDocStore implements DocStore {
  private readonly db: Database;
  private readonly seenRefs = new Map<string, boolean>();
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
        mergeBaseRef TEXT,
        delta TEXT,
        metadata TEXT,
        main BOOLEAN
      );
      CREATE INDEX IF NOT EXISTS remoteSyncIdIndex ON commits (remoteSyncId, remoteSyncIndex);
`);
    const stmt = this.db.prepare(
      `SELECT ref FROM commits ORDER BY remoteSyncId, remoteSyncIndex`,
    );
    const sqliteCommits: Pick<SqliteCommitType, 'ref' | 'main'>[] = stmt.all();
    this.seenRefs = new Map(
      sqliteCommits.map(({ ref, main }) => [ref, main ?? false]),
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
    const commits = sqliteCommits.map(
      (commit): ServerCommit<unknown, unknown> => {
        const {
          ref,
          remoteSyncId,
          userId,
          baseRef,
          mergeRef,
          mergeBaseRef,
          delta,
          metadata,
          main,
        } = commit;

        if (remoteSyncId) {
          syncId = remoteSyncId;
        }

        if (mergeRef) {
          return {
            ref,
            userId,
            baseRef,
            mergeRef,
            mergeBaseRef: mergeBaseRef || undefined,
            delta: delta ? JSON.parse(delta) : undefined,
            metadata: metadata ? JSON.parse(metadata) : undefined,
            main: Boolean(main),
          };
        } else {
          return {
            ref,
            userId,
            baseRef: baseRef || undefined,
            delta: delta ? JSON.parse(delta) : undefined,
            metadata: metadata ? JSON.parse(metadata) : undefined,
            main: Boolean(main),
          };
        }
      },
    );
    return {
      type: 'commits',
      commits,
      syncId,
    };
  }

  add(commits: readonly Commit<unknown, unknown>[]): AckCommitsEvent {
    const remoteSyncId = this.syncIdCreator();
    const insert = this.db.prepare(
      `
        INSERT INTO commits (ref, remoteSyncId, remoteSyncIndex, userId, baseRef, mergeRef, mergeBaseRef, delta, metadata, main) 
        VALUES (@ref, @remoteSyncId, @remoteSyncIndex, @userId, @baseRef, @mergeRef, @mergeBaseRef, @delta, @metadata, @main)
        ON CONFLICT DO NOTHING`,
    );
    const refs = new Map<string, boolean>();
    const refErrors: AckRefErrors = {};
    const invalidParentRef = (
      commit: Commit<unknown, unknown>,
      key: 'baseRef' | 'mergeRef' | 'mergeBaseRef',
    ) => {
      // slightly unsafe type cast here but mergeRef and mergeBaseRef should just be undefined for EditCommits
      const parentRef = (commit as MergeCommit<unknown, unknown>)[key];
      if (parentRef && !this.seenRefs.has(parentRef)) {
        refErrors[commit.ref] = {
          code: 'unknown-ref',
          message: `unknown ${key}`,
        };
        return true;
      }
      return false;
    };

    const computeIsMain = (commit: Commit<unknown, unknown>) => {
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
        const { userId, ref, baseRef, delta, metadata } = commit;

        let mergeRef: string | undefined;
        let mergeBaseRef: string | undefined;

        if (isMergeCommit(commit)) {
          mergeRef = commit.mergeRef;
          mergeBaseRef = commit.mergeBaseRef;
        }

        if (
          invalidParentRef(commit, 'baseRef') ||
          invalidParentRef(commit, 'mergeRef') ||
          invalidParentRef(commit, 'mergeBaseRef')
        ) {
          continue;
        }
        if (this.seenRefs.has(ref)) {
          refs.set(ref, this.seenRefs.get(ref) ?? false);
          continue;
        }
        try {
          let isMain = false;
          if (computeIsMain(commit)) {
            isMain = true;
            this.headRef = commit.ref;
          }

          const { changes } = insert.run({
            userId,
            ref,
            baseRef,
            mergeBaseRef,
            mergeRef,
            delta: JSON.stringify(delta),
            metadata: JSON.stringify(metadata),
            remoteSyncId,
            remoteSyncIndex,
            main: isMain ? 1 : 0,
          });
          if (changes !== 1) {
            throw new Error(`inserted changes unexpectedly ${changes}`);
          }
          refs.set(ref, isMain);
          remoteSyncIndex++;
          this.seenRefs.set(ref, isMain);
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
      acks: Array.from(refs, ([ref, main]) => ({ ref, main })),
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
