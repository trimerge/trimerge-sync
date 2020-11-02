import {
  DiffNode,
  Snapshot,
  SnapshotNode,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
} from './trimerge-sync-store';

type HashFn<Delta, EditMetadata> = (
  baseRef: string | undefined,
  baseRef2: string | undefined,
  delta: Delta,
  editMetadata: EditMetadata,
) => string;

type DiffFn<State, Delta> = (prior: State | undefined, state: State) => Delta;
type PatchFn<State, Delta> = (prior: State | undefined, delta: Delta) => State;

export class TrimergeClient<State, EditMetadata, Delta> {
  private current: SnapshotNode<State, EditMetadata, Delta>;
  private lastSyncCounter: number;

  private unsubscribe: UnsubscribeFn;
  private pendingDiffNodes: DiffNode<State, EditMetadata, Delta>[] = [];
  private bufferTimeout: ReturnType<typeof setTimeout> | undefined;

  public static async create<State, EditMetadata, Delta>(
    store: TrimergeSyncStore<State, EditMetadata, Delta>,
    diff: DiffFn<State, Delta>,
    patch: PatchFn<State, Delta>,
    refHash: HashFn<Delta, EditMetadata>,
    bufferMs: number = 100,
  ): Promise<TrimergeClient<State, EditMetadata, Delta>> {
    return new TrimergeClient(
      await store.getSnapshot(),
      store,
      diff,
      patch,
      refHash,
      bufferMs,
    );
  }

  private constructor(
    initialState: Snapshot<State, EditMetadata, Delta>,
    private readonly store: TrimergeSyncStore<State, EditMetadata, Delta>,
    private readonly diff: DiffFn<State, Delta>,
    private readonly patch: PatchFn<State, Delta>,
    private readonly refHash: (
      baseRef: string | undefined,
      baseRef2: string | undefined,
      delta: Delta,
      editMetadata: EditMetadata,
    ) => string,
    private readonly bufferMs: number = 100,
  ) {
    this.unsubscribe = store.subscribe(initialState.syncCounter, this.onNodes);
    this.current = initialState.snapshot;
    this.lastSyncCounter = initialState.syncCounter;
  }

  addInit(value: State, editMetadata: EditMetadata) {
    this.addNode(value, editMetadata, undefined, undefined, undefined);
    this.mergeHeads();
  }

  get state(): State | undefined {
    return this.current.snapshot;
  }

  addEdit(value: State, editMetadata: EditMetadata) {
    this.addNode(
      value,
      editMetadata,
      this.current.snapshot,
      this.current.ref,
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
    const delta = this.diff(baseValue, value);
    const ref = this.refHash(baseRef, baseRef2, delta, editMetadata);
    this.pendingDiffNodes.push({ ref, baseRef, baseRef2, delta, editMetadata });
    this.sync();
  }

  public shutdown() {
    this.unsubscribe();
  }
}
