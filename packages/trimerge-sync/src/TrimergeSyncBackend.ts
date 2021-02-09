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

export type CursorInfo<CursorState> = {
  userId: string;
  cursorId: string;
  state?: CursorState;
};
export type CursorsEvent<CursorState> = {
  type: 'cursors';
  cursors: readonly CursorInfo<CursorState>[];
};
export type NodesEvent<EditMetadata, Delta> = {
  type: 'nodes';
  nodes: readonly DiffNode<EditMetadata, Delta>[];
  syncId: string;
};
export type AckNodesEvent = {
  type: 'ack';
  refs: readonly string[];
  syncId: string;
};
export type CursorJoinEvent<CursorState> = {
  type: 'cursor-join';
  userId: string;
  cursorId: string;
  state?: CursorState;
};
export type CursorUpdateEvent<CursorState> = {
  type: 'cursor-update';
  userId: string;
  cursorId: string;
  state?: CursorState;
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

export type BackendEvent<EditMetadata, Delta, CursorState> = Readonly<
  | NodesEvent<EditMetadata, Delta>
  | AckNodesEvent
  | CursorsEvent<CursorState>
  | CursorJoinEvent<CursorState>
  | CursorUpdateEvent<CursorState>
  | CursorLeaveEvent
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
  sendNodes(nodes: DiffNode<EditMetadata, Delta>[]): void;
  close(): void | Promise<void>;
}
