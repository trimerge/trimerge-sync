import {
  DiffNode,
  Snapshot,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
  ValueNode,
} from './trimerge-sync-store';
import { mergeHeadNodes } from './merge-nodes';
import { Differ } from './differ';

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

  private stateSubscribers = new Set<(state: State | undefined) => void>();

  private nodes = new Map<string, ValueNode<State, EditMetadata>>();
  private headRefs = new Set<string>();

  private unsubscribe: UnsubscribeFn;
  private unsyncedNodes: DiffNode<State, EditMetadata, Delta>[] = [];

  public static async create<State, EditMetadata, Delta>(
    store: TrimergeSyncStore<State, EditMetadata, Delta>,
    differ: Differ<State, EditMetadata, Delta>,
    bufferMs: number = 100,
  ): Promise<TrimergeClient<State, EditMetadata, Delta>> {
    const snapshot = await store.getSnapshot();
    return new TrimergeClient(snapshot, store, differ, bufferMs);
  }

  private constructor(
    { node, syncCounter, nodes }: Snapshot<State, EditMetadata, Delta>,
    private readonly store: TrimergeSyncStore<State, EditMetadata, Delta>,
    private readonly differ: Differ<State, EditMetadata, Delta>,
    private readonly bufferMs: number = 100,
  ) {
    this.unsubscribe = store.subscribe(syncCounter, this.onNodes);
    if (node !== undefined) {
      this.addNode(node);
    }
    this.onNodes({ syncCounter, newNodes: nodes });
    if (!this.current) {
      this.addEdit(differ.defaultState, differ.defaultEditMetadata);
    }
    this.lastSyncCounter = syncCounter;
  }

  get state(): State {
    if (!this.current) {
      throw new Error('unexpected state');
    }
    return this.current.value;
  }
  subscribe(onStateChange: (state: State | undefined) => void) {
    this.stateSubscribers.add(onStateChange);
    onStateChange(this.state);
    return () => {
      this.stateSubscribers.delete(onStateChange);
    };
  }

  addEdit(value: State, editMetadata: EditMetadata) {
    this.addNewNode(
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
    if (this.headRefs.size <= 1) {
      return;
    }
    mergeHeadNodes(
      Array.from(this.headRefs),
      this.getNode,
      (baseRef, leftRef, rightRef) => {
        const base = baseRef !== undefined ? this.getNode(baseRef) : undefined;
        const left = this.getNode(leftRef);
        const right = this.getNode(rightRef);
        const { value, editMetadata } = this.differ.merge(base, left, right);
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
      const value = this.differ.patch(base, delta);
      this.addNode({ ref, baseRef, baseRef2, value, editMetadata });
    }
    this.mergeHeads();
    this.sync();
  };

  private syncPromise: Promise<boolean> | undefined;

  sync(): Promise<boolean> | undefined {
    if (!this.syncPromise && this.unsyncedNodes.length > 0) {
      this.syncPromise = this.doSync();
    }
    return this.syncPromise;
  }
  private async doSync() {
    while (this.unsyncedNodes.length > 0) {
      await waitMs(this.bufferMs);
      const nodes = this.unsyncedNodes;
      this.unsyncedNodes = [];
      const syncCounter = await this.store.addNodes(nodes);
      if (syncCounter !== this.lastSyncCounter) {
        this.lastSyncCounter = syncCounter;
      }
    }
    this.syncPromise = undefined;
    return true;
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
    const currentRef = this.current?.ref;
    if (currentRef === node.baseRef || currentRef === node.baseRef2) {
      this.current = node;
      for (const subscriber of this.stateSubscribers) {
        subscriber(this.state);
      }
    }
    return true;
  }

  private addNewNode(
    value: State,
    editMetadata: EditMetadata,
    baseValue?: State,
    baseRef?: string,
    baseRef2?: string,
  ): ValueNode<State, EditMetadata> {
    const delta = this.differ.diff(baseValue, value);
    const ref = this.differ.computeRef(baseRef, baseRef2, delta, editMetadata);
    const node = { ref, baseRef, baseRef2, value, editMetadata };
    if (this.addNode(node)) {
      this.unsyncedNodes.push({
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
