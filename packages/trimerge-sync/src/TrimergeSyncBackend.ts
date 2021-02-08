export type ErrorCode = 'invalid-sync-id' | 'invalid-nodes' | 'disconnected';

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

export type CursorInfo<CursorData> = {
  userId: string;
  cursorId: string;
  cursorData: CursorData | undefined;
};
export type CursorsEvent<CursorData> = {
  type: 'cursors';
  cursors: CursorInfo<CursorData>[];
};
export type NodesEvent<EditMetadata, Delta> = {
  type: 'nodes';
  nodes: DiffNode<EditMetadata, Delta>[];
  syncId: string;
};
export type AckNodesEvent = {
  type: 'ack';
  refs: string[];
  syncId: string;
};
export type CursorJoinEvent<CursorData> = {
  type: 'cursor-join';
  userId: string;
  cursorId: string;
  cursorData: CursorData | undefined;
};
export type CursorUpdateEvent<CursorData> = {
  type: 'cursor-update';
  userId: string;
  cursorId: string;
  cursorData: CursorData | undefined;
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
  disconnected?: boolean;
};

export type BackendEvent<EditMetadata, Delta, CursorData> =
  | NodesEvent<EditMetadata, Delta>
  | AckNodesEvent
  | CursorsEvent<CursorData>
  | CursorJoinEvent<CursorData>
  | CursorUpdateEvent<CursorData>
  | CursorLeaveEvent
  | ErrorEvent;

export type OnEventFn<EditMetadata, Delta, CursorData> = (
  event: BackendEvent<EditMetadata, Delta, CursorData>,
) => void;

export type GetSyncBackendFn<EditMetadata, Delta, CursorData> = (
  userId: string,
  cursorId: string,
  lastSyncId: string | undefined,
  onEvent: OnEventFn<EditMetadata, Delta, CursorData>,
) => TrimergeSyncBackend<EditMetadata, Delta, CursorData>;

export interface TrimergeSyncBackend<EditMetadata, Delta, CursorData> {
  sendNodes(nodes: DiffNode<EditMetadata, Delta>[]): void;
  close(): Promise<void>;
}
