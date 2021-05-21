export type ErrorCode =
  | 'invalid-sync-id'
  | 'invalid-nodes'
  | 'internal'
  | 'disconnected'
  | 'network';

export type DiffNode<EditMetadata, Delta> = {
  userId: string;
  clientId: string;
  ref: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
  delta?: Delta;
  editMetadata: EditMetadata;
};

export type LocalReadStatus =
  | 'loading' /** reading state from disk */
  | 'ready'; /** have latest state from disk, receiving local changes */

export type LocalSaveStatus =
  | 'ready' /** no changes in local memory */
  | 'pending' /** changes in local memory, not sent to store yet */
  | 'saving'; /** sent changes to local store, no `ack` yet */

export type RemoteConnectStatus = 'offline' | 'connecting' | 'online';

export type RemoteReadStatus = 'offline' | 'loading' | 'ready';

export type RemoteSaveStatus =
  | 'ready' /**  all local state has been synced to remote (though maybe local changes in memory) */
  | 'pending' /**  we have local state that hasn't been sent to remote yet (maybe offline) */
  | 'saving'; /**  we sent local state to remote, but haven't got `ack` yet */

export type SyncStatus = {
  localRead: LocalReadStatus;
  localSave: LocalSaveStatus;
  remoteConnect: RemoteConnectStatus;
  remoteRead: RemoteReadStatus;
  remoteSave: RemoteSaveStatus;
};

export type ClientPresenceRef<PresenceState> = {
  ref: string | undefined;
  state: PresenceState | undefined;
};

export type ClientInfo<PresenceState> = ClientPresenceRef<PresenceState> & {
  userId: string;
  clientId: string;
};

export type LocalClientInfo<PresenceState> = ClientInfo<PresenceState> & {
  self?: true;
};
export type ClientList<
  PresenceState
> = readonly LocalClientInfo<PresenceState>[];

export type NodesEvent<EditMetadata, Delta, PresenceState> = {
  type: 'nodes';
  nodes: readonly DiffNode<EditMetadata, Delta>[];
  clientInfo?: ClientInfo<PresenceState>;
  syncId: string;
};
export type ReadyEvent = {
  type: 'ready';
};
export type AckNodesEvent = {
  type: 'ack';
  refs: readonly string[];
  syncId: string;
};
export type ClientJoinEvent<PresenceState> = {
  type: 'client-join';
  info: ClientInfo<PresenceState>;
};
export type ClientPresenceEvent<PresenceState> = {
  type: 'client-presence';
  info: ClientInfo<PresenceState>;
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

export type SyncEvent<EditMetadata, Delta, PresenceState> = Readonly<
  | NodesEvent<EditMetadata, Delta, PresenceState>
  | ReadyEvent
  | AckNodesEvent
  | ClientJoinEvent<PresenceState>
  | ClientPresenceEvent<PresenceState>
  | ClientLeaveEvent
  | RemoteStateEvent
  | ErrorEvent
>;

export type OnEventFn<EditMetadata, Delta, PresenceState> = (
  event: SyncEvent<EditMetadata, Delta, PresenceState>,
) => void;

export type GetLocalStoreFn<EditMetadata, Delta, PresenceState> = (
  userId: string,
  clientId: string,
  onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
) => LocalStore<EditMetadata, Delta, PresenceState>;

export type GetRemoteFn<EditMetadata, Delta, PresenceState> = (
  userId: string,
  lastSyncId: string | undefined,
  onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
) => Remote<EditMetadata, Delta, PresenceState>;

export interface LocalStore<EditMetadata, Delta, PresenceState> {
  update(
    nodes: DiffNode<EditMetadata, Delta>[],
    presence: ClientPresenceRef<PresenceState> | undefined,
  ): void;
  shutdown(): void | Promise<void>;
}

export interface Remote<EditMetadata, Delta, PresenceState> {
  send(event: SyncEvent<EditMetadata, Delta, PresenceState>): void;
  shutdown(): void | Promise<void>;
}

export type UnsubscribeFn = () => void;
