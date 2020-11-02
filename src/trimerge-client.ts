import {
  DiffNode,
  Snapshot,
  ValueNode,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
} from './trimerge-sync-store';

export class TrimergeClient<State, EditMetadata, Delta> {
  private current: ValueNode<State, EditMetadata, Delta> | undefined;
  private lastSyncCounter: number;

  private unsubscribe: UnsubscribeFn;
  private pendingDiffNodes: DiffNode<State, EditMetadata, Delta>[] = [];
  private bufferTimeout: ReturnType<typeof setTimeout> | undefined;

  public static async create<State, EditMetadata, Delta>(
    store: TrimergeSyncStore<State, EditMetadata, Delta>,
    bufferMs: number = 100,
  ): Promise<TrimergeClient<State, EditMetadata, Delta>> {
    return new TrimergeClient(await store.getSnapshot(), store, bufferMs);
  }

  private constructor(
    initialState: Snapshot<State, EditMetadata, Delta>,
    private readonly store: TrimergeSyncStore<State, EditMetadata, Delta>,
    private readonly bufferMs: number = 100,
  ) {
    this.unsubscribe = store.subscribe(initialState.syncCounter, this.onNodes);
    this.current = initialState.node;
    this.lastSyncCounter = initialState.syncCounter;
  }

  addInit(value: State, editMetadata: EditMetadata) {
    this.addNode(value, editMetadata, undefined, undefined, undefined);
    this.mergeHeads();
  }

  get state(): State | undefined {
    return this.current?.value;
  }

  addEdit(value: State, editMetadata: EditMetadata) {
    this.addNode(
      value,
      editMetadata,
      this.current?.value,
      this.current?.ref,
      undefined,
    );
    this.mergeHeads();
  }

  mergeHeads() {
    // TODO: merge stuff
  }

  private onNodes: SyncSubscriber<State, EditMetadata, Delta> = () => {
    // TODO: add nodes, merge as needed
  };

  private sync() {
    if (this.bufferTimeout) {
      return;
    }
    this.bufferTimeout = setTimeout(async () => {
      const nodes = this.pendingDiffNodes;
      this.pendingDiffNodes = [];
      this.bufferTimeout = undefined;
      const syncData = await this.store.sync(this.lastSyncCounter, nodes);
      this.onNodes(syncData);
    }, this.bufferMs);
  }

  protected addNode(
    value: State,
    editMetadata: EditMetadata,
    baseValue?: State,
    baseRef?: string,
    baseRef2?: string,
  ): void {
    const delta = this.store.diff(baseValue, value);
    const ref = this.store.computeRef(baseRef, baseRef2, delta, editMetadata);
    this.pendingDiffNodes.push({ ref, baseRef, baseRef2, delta, editMetadata });
    this.sync();
  }

  public shutdown() {
    this.unsubscribe();
  }
}
