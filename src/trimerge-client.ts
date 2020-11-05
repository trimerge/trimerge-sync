import {
  DiffNode,
  Snapshot,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
  ValueNode,
} from './trimerge-sync-store';
import { mergeHeadNodes } from './merge-nodes';

export type ValueState<State, EditMetadata> = {
  value: State;
  editMetadata: EditMetadata;
};

export type MergeStateFn<State, EditMetadata> = (
  base: ValueState<State, EditMetadata> | undefined,
  left: ValueState<State, EditMetadata>,
  right: ValueState<State, EditMetadata>,
) => ValueState<State, EditMetadata>;

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TrimergeClient<State, EditMetadata, Delta> {
  private current: ValueNode<State, EditMetadata> | undefined;
  private lastSyncCounter: number;

  private nodes = new Map<string, ValueNode<State, EditMetadata>>();
  private headRefs = new Set<string>();

  private unsubscribe: UnsubscribeFn;
  private pendingDiffNodes: DiffNode<State, EditMetadata, Delta>[] = [];
  private bufferTimeout: ReturnType<typeof setTimeout> | undefined;

  public static async create<State, EditMetadata, Delta>(
    store: TrimergeSyncStore<State, EditMetadata, Delta>,
    merge: MergeStateFn<State, EditMetadata>,
    bufferMs: number = 100,
  ): Promise<TrimergeClient<State, EditMetadata, Delta>> {
    return new TrimergeClient(
      await store.getSnapshot(),
      store,
      merge,
      bufferMs,
    );
  }

  private constructor(
    { node, syncCounter }: Snapshot<State, EditMetadata>,
    private readonly store: TrimergeSyncStore<State, EditMetadata, Delta>,
    private readonly merge: MergeStateFn<State, EditMetadata>,
    private readonly bufferMs: number = 100,
  ) {
    this.unsubscribe = store.subscribe(syncCounter, this.onNodes);
    this.current = node;
    this.lastSyncCounter = syncCounter;
  }

  get state(): State | undefined {
    return this.current?.value;
  }

  editState(value: State, editMetadata: EditMetadata) {
    this.current = this.addNewNode(
      value,
      editMetadata,
      this.current?.value,
      this.current?.ref,
    );
    this.mergeHeads();
    this.sync();
  }

  getNode = (ref: string) => {
    const node = this.nodes.get(ref);
    if (node) {
      return node;
    }
    throw new Error(`unknown node ref "${ref}"`);
  };

  private mergeHeads() {
    console.log('merging heads:', Array.from(this.headRefs));
    mergeHeadNodes(
      Array.from(this.headRefs),
      this.getNode,
      (baseRef, leftRef, rightRef) => {
        const left = this.getNode(leftRef);
        const { value, editMetadata } = this.merge(
          baseRef !== undefined ? this.getNode(baseRef) : undefined,
          left,
          this.getNode(rightRef),
        );
        return this.addNewNode(
          value,
          editMetadata,
          left.value,
          leftRef,
          rightRef,
        ).ref;
      },
    );
    // TODO: do we clear out nodes we don't need anymore?
  }

  private onNodes: SyncSubscriber<State, EditMetadata, Delta> = (data) => {
    for (const {
      ref,
      baseRef,
      baseRef2,
      delta,
      editMetadata,
    } of data.newNodes) {
      const base =
        baseRef !== undefined ? this.getNode(baseRef).value : undefined;
      const value = this.store.patch(base, delta);
      this.addNode({ ref, baseRef, baseRef2, value, editMetadata });
    }
    this.mergeHeads();
    this.sync();
  };

  private syncPromise: Promise<void> | undefined;

  sync() {
    if (!this.syncPromise) {
      this.syncPromise = this.doSync();
    }
    return this.syncPromise;
  }
  private async doSync() {
    if (this.bufferMs > 0) {
      await waitMs(this.bufferMs);
    }
    const nodes = this.pendingDiffNodes;
    this.pendingDiffNodes = [];
    this.bufferTimeout = undefined;
    const syncData = await this.store.sync(this.lastSyncCounter, nodes);
    this.onNodes(syncData);
    this.syncPromise = undefined;
  }

  private addNode(node: ValueNode<State, EditMetadata>): boolean {
    const ref = node.ref;
    if (this.nodes.has(ref)) {
      return false;
    }
    this.nodes.set(ref, node);
    if (node.baseRef !== undefined) {
      this.headRefs.delete(node.baseRef);
    }
    if (node.baseRef2 !== undefined) {
      this.headRefs.delete(node.baseRef2);
    }
    this.headRefs.add(ref);
    return true;
  }

  private addNewNode(
    value: State,
    editMetadata: EditMetadata,
    baseValue?: State,
    baseRef?: string,
    baseRef2?: string,
  ): ValueNode<State, EditMetadata> {
    const delta = this.store.diff(baseValue, value);
    const ref = this.store.computeRef(baseRef, baseRef2, delta, editMetadata);
    const node = { ref, baseRef, baseRef2, value, editMetadata };
    if (this.addNode(node)) {
      this.pendingDiffNodes.push({
        ref,
        baseRef,
        baseRef2,
        delta,
        editMetadata,
      });
    }
    return node;
  }

  public shutdown() {
    this.unsubscribe();
  }
}
