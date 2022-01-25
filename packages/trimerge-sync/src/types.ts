export type ErrorCode =
  | 'invalid-sync-id'
  | 'invalid-commits'
  | 'internal'
  | 'disconnected'
  | 'network'
  | 'bad-request'
  | 'unauthorized';

export type BaseCommit<EditMetadata = unknown, Delta = unknown> = {
  ref: string;

  // The ref of the parent commit that the delta was based on
  // or undefined if it's an initial document commit
  baseRef?: string;

  // a structure defining the differences between baseRef and this commit
  delta?: Delta;

  // application-specific metadata about the commit
  metadata: EditMetadata;
};

export type EditCommit<EditMetadata = unknown, Delta = unknown> = BaseCommit<
  EditMetadata,
  Delta
>;

export type MergeCommit<EditMetadata = unknown, Delta = unknown> = BaseCommit<
  EditMetadata,
  Delta
> & {
  // primary parent of the merge commit
  baseRef: string;

  // secondary parent of the merge commit
  mergeRef: string;
};

export function isMergeCommit<EditMetadata = unknown, Delta = unknown>(
  commit: Commit<EditMetadata, Delta>,
): commit is MergeCommit<EditMetadata, Delta> {
  return (commit as MergeCommit).mergeRef !== undefined;
}

export type CommitInfo = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
};

export type Commit<EditMetadata = unknown, Delta = unknown> =
  | MergeCommit<EditMetadata, Delta>
  | EditCommit<EditMetadata, Delta>;

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

export type RemoteReadStatus = 'offline' | 'loading' | 'ready';

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
    };

export type CommitAck<EditMetadata = unknown> = {
  ref: string;
  metadata?: EditMetadata;
};

export type CommitsEvent<EditMetadata, Delta, Presence> = {
  type: 'commits';
  commits: readonly Commit<EditMetadata, Delta>[];
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
export type AckCommitsEvent<EditMetadata = unknown> = {
  type: 'ack';
  acks: readonly CommitAck<EditMetadata>[];
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
export type SyncEvent<EditMetadata, Delta, Presence> = Readonly<
  | InitEvent
  | CommitsEvent<EditMetadata, Delta, Presence>
  | ReadyEvent
  | LeaderEvent
  | AckCommitsEvent<EditMetadata>
  | ClientJoinEvent<Presence>
  | ClientPresenceEvent<Presence>
  | ClientLeaveEvent
  | RemoteStateEvent
  | ErrorEvent
>;

export type OnStoreEventFn<EditMetadata, Delta, Presence> = (
  event: SyncEvent<EditMetadata, Delta, Presence>,
  remoteOrigin: boolean,
) => void;

export type OnRemoteEventFn<EditMetadata, Delta, Presence> = (
  event: SyncEvent<EditMetadata, Delta, Presence>,
) => void;

export type GetLocalStoreFn<EditMetadata, Delta, Presence> = (
  userId: string,
  clientId: string,
  onEvent: OnStoreEventFn<EditMetadata, Delta, Presence>,
) => LocalStore<EditMetadata, Delta, Presence>;

export type RemoteSyncInfo = {
  localStoreId: string;
  lastSyncCursor: string | undefined;
};

export type GetRemoteFn<EditMetadata, Delta, Presence> = (
  userId: string,
  remoteSyncInfo: RemoteSyncInfo,
  onRemoteEvent: OnRemoteEventFn<EditMetadata, Delta, Presence>,
) =>
  | Remote<EditMetadata, Delta, Presence>
  | Promise<Remote<EditMetadata, Delta, Presence>>;

export interface LocalStore<EditMetadata, Delta, Presence> {
  update(
    commits: Commit<EditMetadata, Delta>[],
    presence: ClientPresenceRef<Presence> | undefined,
  ): void;
  isRemoteLeader: boolean;
  shutdown(): void | Promise<void>;
}

export interface Remote<EditMetadata, Delta, Presence> {
  send(event: SyncEvent<EditMetadata, Delta, Presence>): void;
  shutdown(): void | Promise<void>;
}
