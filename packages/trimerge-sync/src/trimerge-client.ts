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

function waitMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TrimergeClient<State, EditMetadata, Delta> {
  private current?: { value: State; ref?: string };
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
    this.current = {
      value: differ.normalize(this.current?.value),
      ref: this.current?.ref,
    };
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
    const delta = this.differ.diff(this.current?.value, value);
    if (delta === undefined) {
      return;
    }
    this.addNewNode(value, editMetadata, delta, this.current?.ref);
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
        const delta = this.differ.diff(left.value, value);
        return this.addNewNode(value, editMetadata, delta, leftRef, rightRef);
      },
    );
    // TODO: do we clear out nodes we don't need anymore?
  }

  private onNodes: SyncSubscriber<State, EditMetadata, Delta> = (data) => {
    for (const {
      ref,
      baseRef,
      mergeRef,
      delta,
      editMetadata,
    } of data.newNodes) {
      const base =
        baseRef !== undefined ? this.getNode(baseRef).value : undefined;
      const value = this.differ.patch(base, delta);
      this.addNode({ ref, baseRef, mergeRef, value, editMetadata });
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
    const { ref, baseRef, mergeRef } = node;
    if (this.nodes.has(ref)) {
      return false;
    }
    this.nodes.set(ref, node);
    if (baseRef !== undefined) {
      this.headRefs.delete(baseRef);
    }
    if (mergeRef !== undefined) {
      this.headRefs.delete(mergeRef);
    }
    this.headRefs.add(ref);
    const currentRef = this.current?.ref;
    if (currentRef === node.baseRef || currentRef === node.mergeRef) {
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
    delta: Delta | undefined,
    baseRef?: string,
    mergeRef?: string,
  ): string {
    const ref = this.differ.computeRef(baseRef, mergeRef, delta, editMetadata);
    if (this.addNode({ ref, baseRef, mergeRef, value, editMetadata })) {
      const syncNode: DiffNode<State, EditMetadata, Delta> = {
        ref,
        delta,
        editMetadata,
      };
      if (baseRef) {
        syncNode.baseRef = baseRef;
      }
      if (mergeRef) {
        syncNode.mergeRef = mergeRef;
      }
      this.unsyncedNodes.push(syncNode);
    }
    return ref;
  }

  public shutdown() {
    this.unsubscribe();
  }
}
