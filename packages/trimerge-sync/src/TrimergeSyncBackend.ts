export type ErrorCode =
  | 'invalid-sync-id'
  | 'invalid-nodes'
  | 'internal'
  | 'disconnected'
  | 'network';

export type DiffNode<EditMetadata, Delta> = {
  userId: string;
  cursorId: string;
  ref: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
  delta?: Delta;
  editMetadata: EditMetadata;
};

export type LocalReadState =
  | 'loading' /** reading state from disk */
  | 'ready'; /** have latest state from disk, receiving local changes */

export type LocalSaveState =
  | 'ready' /** no changes in local memory */
  | 'pending' /** changes in local memory, not sent to store yet */
  | 'saving'; /** sent changes to local store, no `ack` yet */

export type RemoteConnectState = 'offline' | 'connecting' | 'online';

export type RemoteReadState = 'offline' | 'loading' | 'ready';

export type RemoteSaveState =
  | 'ready' /**  all local state has been synced to remote (though maybe local changes in memory) */
  | 'pending' /**  we have local state that hasn't been sent to remote yet (maybe offline) */
  | 'saving'; /**  we sent local state to remote, but haven't got `ack` yet */

export type SyncState = {
  localRead: LocalReadState;
  localSave: LocalSaveState;
  remoteConnect: RemoteConnectStateEvent;
  remoteRead: RemoteReadState;
  remoteSave: RemoteSaveState;
};

export type CursorRef<CursorState> = {
  ref: string | undefined;
  state: CursorState | undefined;
};

export type CursorInfo<CursorState> = CursorRef<CursorState> & {
  userId: string;
  cursorId: string;
  origin: 'self' | 'local' | 'remote';
};

export type NodesEvent<EditMetadata, Delta, CursorState> = {
  type: 'nodes';
  nodes: readonly DiffNode<EditMetadata, Delta>[];
  cursor?: CursorInfo<CursorState>;
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
export type CursorJoinEvent<CursorState> = {
  type: 'cursor-join';
  cursor: CursorInfo<CursorState>;
};
export type CursorUpdateEvent<CursorState> = {
  type: 'cursor-update';
  cursor: CursorInfo<CursorState>;
};
export type CursorHereEvent<CursorState> = {
  type: 'cursor-here';
  cursor: CursorInfo<CursorState>;
};
export type CursorLeaveEvent = {
  type: 'cursor-leave';
  userId: string;
  cursorId: string;
};
export type ErrorEvent = {
  type: 'error';
  code: ErrorCode;
  message?: string;
  fatal?: boolean;
  reconnectAfter?: number;
};
export type RemoteStateEvent = {
  type: 'remote-state';
  connect?: RemoteConnectState;
  read?: RemoteReadState;
  save?: RemoteSaveState;
};

export type BackendEvent<EditMetadata, Delta, CursorState> = Readonly<
  | NodesEvent<EditMetadata, Delta, CursorState>
  | ReadyEvent
  | AckNodesEvent
  | CursorJoinEvent<CursorState>
  | CursorHereEvent<CursorState>
  | CursorUpdateEvent<CursorState>
  | CursorLeaveEvent
  | RemoteStateEvent
  | ErrorEvent
>;

export type OnEventFn<EditMetadata, Delta, CursorState> = (
  event: BackendEvent<EditMetadata, Delta, CursorState>,
) => void;

export type GetSyncBackendFn<EditMetadata, Delta, CursorState> = (
  userId: string,
  cursorId: string,
  lastSyncId: string | undefined,
  onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
) => TrimergeSyncBackend<EditMetadata, Delta, CursorState>;

export interface TrimergeSyncBackend<EditMetadata, Delta, CursorState> {
  broadcast(event: BackendEvent<EditMetadata, Delta, CursorState>): void;
  update(
    nodes: DiffNode<EditMetadata, Delta>[],
    cursor: CursorRef<CursorState> | undefined,
  ): void;
  close(): void | Promise<void>;
}

export type UnsubscribeFn = () => void;
export interface TrimergeSyncBackend2<EditMetadata, Delta, CursorState> {
  send(event: BackendEvent<EditMetadata, Delta, CursorState>): void;
  subscribe(
    onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ): UnsubscribeFn;
}
