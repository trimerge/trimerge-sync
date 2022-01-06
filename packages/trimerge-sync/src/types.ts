export type ErrorCode =
  | 'invalid-sync-id'
  | 'invalid-commits'
  | 'internal'
  | 'disconnected'
  | 'network'
  | 'bad-request'
  | 'unauthorized';

export type BaseCommitBody<EditMetadata, Delta> = {
  userId: string;
  ref: string;

  // a structure defining the differences between baseRef and this commit
  delta?: Delta;

  // application specific metadata about the commit, that all clients should get.
  metadata: EditMetadata;

  // The ref of the commit that this commit is based on
  baseRef?: string;
};

export type EditCommitBody<EditMetadata, Delta> = BaseCommitBody<
  EditMetadata,
  Delta
>;

export type MergeCommitBody<EditMetadata, Delta> = BaseCommitBody<
  EditMetadata,
  Delta
> & {
  // primary parent of the merge commit
  baseRef: string;

  // secondary parent of the merge commit
  mergeRef: string;

  // the most recent common ancestor of the baseRef and mergeRef,
  // can be undefined if multiple clients are editing the same new document.
  mergeBaseRef?: string;
};

export function isMergeCommit(
  commit: CommitBody<unknown, unknown>,
): commit is MergeCommitBody<unknown, unknown> {
  return (commit as MergeCommitBody<unknown, unknown>).mergeRef !== undefined;
}

// indicates if the commit has already been acked by the server.
export function hasAck<EditMetadata, Delta, CreationMetadata>(
  commit: Commit<EditMetadata, Delta, CreationMetadata>,
): commit is
  | ConfirmedCommit<EditMetadata, Delta, CreationMetadata>
  | RemoteCommit<EditMetadata, Delta> {
  return (
    (
      commit as
        | ConfirmedCommit<EditMetadata, Delta, CreationMetadata>
        | RemoteCommit<EditMetadata, Delta>
    ).ackMetadata !== undefined
  );
}

export type CommitBody<EditMetadata, Delta> =
  | MergeCommitBody<EditMetadata, Delta>
  | EditCommitBody<EditMetadata, Delta>;

export type AckMetadata = {
  main: boolean;
  cursor: string;
};

export type BaseCommit<EditMetadata, Delta> = {
  body: CommitBody<EditMetadata, Delta>;
};

// This is a commit that was generated locally but has not been confirmed by the server.
export type UnconfirmedCommit<EditMetadata, Delta, CreationMetadata> =
  BaseCommit<EditMetadata, Delta> & {
    body: CommitBody<EditMetadata, Delta>;

    // information about the commit that won't be sent to other clients.
    creationMetadata: CreationMetadata;
  };

// This is a commit that was generated locally and has been confirmed by the server.
export type ConfirmedCommit<EditMetadata, Delta, CreationMetadata> =
  UnconfirmedCommit<EditMetadata, Delta, CreationMetadata> & {
    ackMetadata: AckMetadata;
  };

// This is a commit that was generated remotely.
export type RemoteCommit<EditMetadata, Delta> = BaseCommit<
  EditMetadata,
  Delta
> & {
  ackMetadata: AckMetadata;
};

export type Commit<EditMetadata, Delta, CreationMetadata> =
  | ConfirmedCommit<EditMetadata, Delta, CreationMetadata>
  | UnconfirmedCommit<EditMetadata, Delta, CreationMetadata>
  | RemoteCommit<EditMetadata, Delta>;

// useful for optionally grabbing the potentially undefined fields from a commit.
export type FlatCommit<EditMetadata, Delta, CreationMetadata> = {
  body: CommitBody<EditMetadata, Delta>;
  ackMetadata?: AckMetadata;
  creationMetadata?: CreationMetadata;
};

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

export type CommitAck = Partial<AckMetadata> & {
  ref: string;
};

export type CommitsEvent<EditMetadata, Delta, Presence, CreationMetadata> = {
  type: 'commits';
  commits: readonly Commit<EditMetadata, Delta, CreationMetadata>[];
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
export type AckCommitsEvent = {
  type: 'ack';
  acks: readonly CommitAck[];
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
export type SyncEvent<EditMetadata, Delta, Presence, CreationMetadata> =
  Readonly<
    | InitEvent
    | CommitsEvent<EditMetadata, Delta, Presence, CreationMetadata>
    | ReadyEvent
    | LeaderEvent
    | AckCommitsEvent
    | ClientJoinEvent<Presence>
    | ClientPresenceEvent<Presence>
    | ClientLeaveEvent
    | RemoteStateEvent
    | ErrorEvent
  >;

export type OnEventFn<EditMetadata, Delta, Presence, CreationMetadata> = (
  event: SyncEvent<EditMetadata, Delta, Presence, CreationMetadata>,
) => void;

export type GetLocalStoreFn<EditMetadata, Delta, Presence, CreationMetadata> = (
  userId: string,
  clientId: string,
  onEvent: OnEventFn<EditMetadata, Delta, Presence, CreationMetadata>,
) => LocalStore<EditMetadata, Delta, Presence, CreationMetadata>;

export type RemoteSyncInfo = {
  localStoreId: string;
  lastSyncCursor: string | undefined;
};

export type GetCreationMetadataFn<CreationMetadata> = () => CreationMetadata;

export type GetRemoteFn<EditMetadata, Delta, Presence, CreationMetadata> = (
  userId: string,
  remoteSyncInfo: RemoteSyncInfo,
  onEvent: OnEventFn<EditMetadata, Delta, Presence, CreationMetadata>,
) =>
  | Remote<EditMetadata, Delta, Presence, CreationMetadata>
  | Promise<Remote<EditMetadata, Delta, Presence, CreationMetadata>>;

export interface LocalStore<EditMetadata, Delta, Presence, CreationMetadata> {
  update(
    commits: Commit<EditMetadata, Delta, CreationMetadata>[],
    presence: ClientPresenceRef<Presence> | undefined,
  ): void;
  isRemoteLeader: boolean;
  shutdown(): void | Promise<void>;
}

export interface Remote<EditMetadata, Delta, Presence, CreationMetadata> {
  send(event: SyncEvent<EditMetadata, Delta, Presence, CreationMetadata>): void;
  shutdown(): void | Promise<void>;
}

export type UnsubscribeFn = () => void;
