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
export type ValueNode<State, EditMetadata, Delta> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  value: State;
  editMetadata: EditMetadata;
};

export type Snapshot<State, EditMetadata, Delta> = {
  syncCounter: number;
  node: ValueNode<State, EditMetadata, Delta> | undefined;
};

export type SyncSubscriber<State, EditMetadata, Delta> = (
  data: SyncData<State, EditMetadata, Delta>,
) => void;
export type UnsubscribeFn = () => void;

export type SyncData<State, EditMetadata, Delta> = {
  syncCounter: number;
  newNodes: DiffNode<State, EditMetadata, Delta>[];
};

export type ComputeRefFn<Delta, EditMetadata> = (
  baseRef: string | undefined,
  baseRef2: string | undefined,
  delta: Delta,
  editMetadata: EditMetadata,
) => string;

export type DiffFn<State, Delta> = (
  prior: State | undefined,
  state: State,
) => Delta;

export type PatchFn<State, Delta> = (
  prior: State | undefined,
  delta: Delta,
) => State;

export interface TrimergeSyncStore<State, EditMetadata, Delta> {
  /**
   * This should represent everything to show the current document.
   *
   * It should also return the current sync counter for use in subscribe/sync methods
   */
  getSnapshot(): Promise<Snapshot<State, EditMetadata, Delta>>;

  /**
   * This sets up a subscriber callback that's called for every new node since lastSyncCounter
   *
   * @param lastSyncCounter
   * @param onNodes
   */
  subscribe(
    lastSyncCounter: number,
    onNodes: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn;

  /**
   * This sends up new nodes and returns any new added in the interim.
   *
   * @param lastSyncCounter
   * @param newNodes
   */
  sync(
    lastSyncCounter?: number,
    newNodes?: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<SyncData<State, EditMetadata, Delta>>;

  readonly diff: DiffFn<State, Delta>;
  readonly patch: PatchFn<State, Delta>;
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;
}
