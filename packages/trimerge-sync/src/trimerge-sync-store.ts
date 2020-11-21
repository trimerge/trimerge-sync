// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
export type DiffNode<State, EditMetadata, Delta> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  delta: Delta;
  editMetadata: EditMetadata;
};

export type ValueNode<State, EditMetadata> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  value: State;
  editMetadata: EditMetadata;
};

export type Snapshot<State, EditMetadata, Delta> = {
  syncCounter: number;
  node?: ValueNode<State, EditMetadata>;
  nodes: DiffNode<State, EditMetadata, Delta>[];
};

export type SyncSubscriber<State, EditMetadata, Delta> = (
  data: SyncData<State, EditMetadata, Delta>,
) => void;
export type UnsubscribeFn = () => void;

export type SyncData<State, EditMetadata, Delta> = {
  syncCounter: number;
  newNodes: DiffNode<State, EditMetadata, Delta>[];
};

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
   * This sends up new nodes and returns new sync counter
   *
   * @param newNodes
   */
  addNodes(newNodes: DiffNode<State, EditMetadata, Delta>[]): Promise<number>;
}
