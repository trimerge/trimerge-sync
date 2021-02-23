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
  self?: boolean;
};

export type CursorInfo<CursorState> = CursorRef<CursorState> & {
  userId: string;
  cursorId: string;
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

export type BackendEvent<EditMetadata, Delta, CursorState> = Readonly<
  | NodesEvent<EditMetadata, Delta, CursorState>
  | AckNodesEvent
  | CursorsEvent<CursorState>
  | CursorJoinEvent<CursorState>
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
  update(
    nodes: DiffNode<EditMetadata, Delta>[],
    cursor: CursorRef<CursorState> | undefined,
  ): void;
  close(): void | Promise<void>;
}
