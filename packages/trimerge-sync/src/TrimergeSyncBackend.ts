export type ErrorCode =
  | 'invalid-sync-id'
  | 'invalid-nodes'
  | 'internal'
  | 'disconnected';

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

export type CursorRef<CursorState> = {
  ref: string | undefined;
  state: CursorState | undefined;
};

export type CursorInfo<CursorState> = CursorRef<CursorState> & {
  userId: string;
  cursorId: string;
  origin: 'self' | 'local' | 'remote';
};

export type CursorsEvent<CursorState> = {
  type: 'cursors';
  cursors: readonly CursorInfo<CursorState>[];
};
export type NodesEvent<EditMetadata, Delta, CursorState> = {
  type: 'nodes';
  nodes: readonly DiffNode<EditMetadata, Delta>[];
  cursors: readonly CursorInfo<CursorState>[];
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
export type CursorJoinEvent<CursorState> = CursorInfo<CursorState> & {
  type: 'cursor-join';
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
};
export type RemoteConnect = {
  type: 'remote-connect';
};
export type RemoteDisconnect = {
  type: 'remote-disconnect';
};

export type BackendEvent<EditMetadata, Delta, CursorState> = Readonly<
  | NodesEvent<EditMetadata, Delta, CursorState>
  | ReadyEvent
  | AckNodesEvent
  | CursorsEvent<CursorState>
  | CursorJoinEvent<CursorState>
  | CursorLeaveEvent
  | RemoteConnect
  | RemoteDisconnect
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
