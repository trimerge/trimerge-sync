import type { JSONValue } from 'trimerge';

export type ErrorCode =
  | 'invalid-sync-id'
  | 'invalid-commits'
  | 'internal'
  | 'disconnected'
  | 'network'
  | 'bad-request'
  | 'unauthorized';

export type BaseCommit<CommitMetadata = unknown, Delta = unknown> = {
  ref: string;

  // The ref of the parent commit that the delta was based on
  // or undefined if it's an initial document commit
  baseRef?: string;

  // a structure defining the differences between baseRef and this commit
  delta?: Delta;

  // application-specific metadata about the commit
  metadata: CommitMetadata;
};

export type EditCommit<CommitMetadata = unknown, Delta = unknown> = BaseCommit<
  CommitMetadata,
  Delta
>;

export type MergeCommit<CommitMetadata = unknown, Delta = unknown> = BaseCommit<
  CommitMetadata,
  Delta
> & {
  // primary parent of the merge commit
  baseRef: string;

  // secondary parent of the merge commit
  mergeRef: string;
};

export function isMergeCommit<CommitMetadata = unknown, Delta = unknown>(
  commit: Commit<CommitMetadata, Delta>,
): commit is MergeCommit<CommitMetadata, Delta> {
  return (commit as MergeCommit).mergeRef !== undefined;
}

export type CommitInfo = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
};

export type Commit<CommitMetadata = unknown, Delta = unknown> =
  | MergeCommit<CommitMetadata, Delta>
  | EditCommit<CommitMetadata, Delta>;

export type LocalReadStatus =
  | 'loading' /** reading state from disk */
  | 'error'
  | 'ready'; /** have latest state from disk, receiving local changes */

export type LocalSaveStatus =
  | 'ready' /** no changes in local memory */
  | 'error'
  | 'pending' /** changes in local memory, not sent to store yet */
  | 'saving'; /** sent changes to local store, no `ack` yet */

export type RemoteConnectStatus = 'offline' | 'connecting' | 'online';

export type RemoteReadStatus =
  | 'offline'
  | 'loading'
  | 'ready'
  | 'error' /** the remote is in a persistent bad state */;

export type RemoteSaveStatus =
  | 'ready' /**  all local state has been synced to remote (though maybe local changes in memory) */
  | 'pending' /**  we have local state that hasn't been sent to remote yet (maybe offline) */
  | 'saving' /**  we got an error back from remote when saving commits  */
  | 'error'; /**  we sent local state to remote, but haven't got `ack` yet */

export type SyncStatus = {
  localRead: LocalReadStatus;
  localSave: LocalSaveStatus;
  remoteConnect: RemoteConnectStatus;
  remoteRead: RemoteReadStatus;
  remoteSave: RemoteSaveStatus;
};

export type ClientPresenceRef<Presence> = {
  ref: string | undefined;
  presence: Presence | undefined;
};

export type ClientInfo<Presence> = ClientPresenceRef<Presence> & {
  userId: string;
  clientId: string;
};

export type LocalClientInfo<Presence> = ClientInfo<Presence> & {
  self?: true;
};
export type ClientList<Presence> = readonly LocalClientInfo<Presence>[];

export type InitEvent =
  | {
      type: 'init';
      version?: undefined;
      lastSyncId: string | undefined;
      auth: unknown;
    }
  | {
      type: 'init';
      version: 1;
      localStoreId: string;
      lastSyncCursor: string | undefined;
      auth: unknown;
      docId?: string;
    };

export type CommitAck<CommitMetadata = unknown> = {
  ref: string;
  metadata?: CommitMetadata;
};

export type CommitsEvent<CommitMetadata, Delta, Presence> = {
  type: 'commits';
  commits: readonly Commit<CommitMetadata, Delta>[];
  clientInfo?: ClientInfo<Presence>;
  syncId?: string;
};

export type ReadyEvent = {
  type: 'ready';
};

export type AckCommitErrorCode =
  | 'invalid'
  | 'unknown-ref'
  | 'storage-failure'
  | 'internal';

export type AckCommitError = {
  code: AckCommitErrorCode;
  message?: string;
};
export type AckRefErrors = Record<string, AckCommitError>;
export type AckCommitsEvent<CommitMetadata = unknown> = {
  type: 'ack';
  acks: readonly CommitAck<CommitMetadata>[];
  refErrors?: AckRefErrors;
  syncId: string;
};
export type ClientJoinEvent<Presence> = {
  type: 'client-join';
  info: ClientInfo<Presence>;
};
export type ClientPresenceEvent<Presence> = {
  type: 'client-presence';
  info: ClientInfo<Presence>;
};
export type ClientLeaveEvent = {
  type: 'client-leave';
  userId: string;
  clientId: string;
};
export type ErrorEvent = {
  type: 'error';
  code: ErrorCode;
  message?: string;
  fatal?: boolean;
  reconnect?: boolean;
};
export type RemoteStateEvent = {
  type: 'remote-state';
  connect?: RemoteConnectStatus;
  read?: RemoteReadStatus;
  save?: RemoteSaveStatus;
};

export type LeaderEvent = {
  type: 'leader';
  action: 'request' | 'current' | 'accept' | 'withdraw';
  clientId: string;
};
export type SyncEvent<CommitMetadata, Delta, Presence> = Readonly<
  | InitEvent
  | CommitsEvent<CommitMetadata, Delta, Presence>
  | ReadyEvent
  | LeaderEvent
  | AckCommitsEvent<CommitMetadata>
  | ClientJoinEvent<Presence>
  | ClientPresenceEvent<Presence>
  | ClientLeaveEvent
  | RemoteStateEvent
  | ErrorEvent
>;

export type OnStoreEventFn<CommitMetadata, Delta, Presence> = (
  event: SyncEvent<CommitMetadata, Delta, Presence>,
  remoteOrigin: boolean,
) => void;

export type OnRemoteEventFn<CommitMetadata, Delta, Presence> = (
  event: SyncEvent<CommitMetadata, Delta, Presence>,
) => void;

export type GetLocalStoreFn<CommitMetadata, Delta, Presence> = (
  userId: string,
  clientId: string,
  onEvent: OnStoreEventFn<CommitMetadata, Delta, Presence>,
) => LocalStore<CommitMetadata, Delta, Presence>;

export type RemoteSyncInfo = {
  /** The latest cursor that we're aware of from this remote. */
  lastSyncCursor?: string;

  /** The first cursor after we've been syncing all changes. */
  firstSyncCursor?: string;
};

export type GetRemoteFn<CommitMetadata, Delta, Presence> = (
  userId: string,
  localStoreId: string,
  remoteSyncInfo: RemoteSyncInfo,
  onRemoteEvent: OnRemoteEventFn<CommitMetadata, Delta, Presence>,
) =>
  | Remote<CommitMetadata, Delta, Presence>
  | Promise<Remote<CommitMetadata, Delta, Presence>>;

export interface LocalStore<CommitMetadata, Delta, Presence> {
  update(
    commits: readonly Commit<CommitMetadata, Delta>[],
    presence: ClientPresenceRef<Presence> | undefined,
  ): Promise<void>;
  isRemoteLeader: boolean;
  shutdown(): void | Promise<void>;
}

export interface Remote<CommitMetadata, Delta, Presence> {
  send(event: SyncEvent<CommitMetadata, Delta, Presence>): void;
  shutdown(): void | Promise<void>;
}

export interface CommitRepository<CommitMetadata, Delta, Presence> {
  getLocalCommits(): AsyncIterableIterator<
    CommitsEvent<CommitMetadata, Delta, Presence>
  >;

  getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<CommitMetadata, Delta, Presence>
  >;

  addCommits(
    commits: readonly Commit<CommitMetadata, Delta>[],
    remoteSyncId: string | undefined,
  ): Promise<AckCommitsEvent<CommitMetadata>>;

  acknowledgeRemoteCommits(
    refs: readonly CommitAck<CommitMetadata>[],
    remoteSyncId: string,
  ): Promise<void>;

  getRemoteSyncInfo(): Promise<RemoteSyncInfo>;

  shutdown(): void | Promise<void>;
}
