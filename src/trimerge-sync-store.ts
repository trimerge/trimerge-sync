// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export type DiffNode<State, EditMetadata, Delta> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  delta: Delta;
  editMetadata: EditMetadata;
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export type SnapshotNode<State, EditMetadata, Delta> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  snapshot: State;
  editMetadata: EditMetadata;
};

export type InitialState<State, EditMetadata, Delta> = {
  syncCounter: number;
  snapshot?: SnapshotNode<State, EditMetadata, Delta>;
  nodes: DiffNode<State, EditMetadata, Delta>[];
};

export type DiffNodeSubscriber<State, EditMetadata, Delta> = (
  nodes: DiffNode<State, EditMetadata, Delta>[],
) => void;
export type UnsubscribeFn = () => void;

export type SyncResult<State, EditMetadata, Delta> = {
  syncCounter: number;
  newNodes: DiffNode<State, EditMetadata, Delta>[];
};

export interface TrimergeSyncStore<State, EditMetadata, Delta> {
  initialize(): Promise<InitialState<State, EditMetadata, Delta>>;

  subscribe(
    onDiffNodes: (nodes: DiffNode<State, EditMetadata, Delta>[]) => void,
  ): Promise<UnsubscribeFn>;

  sync(
    lastSyncCounter: number,
    newNodes?: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<SyncResult<State, EditMetadata, Delta>>;
}
