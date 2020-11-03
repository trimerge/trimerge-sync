import {
  ComputeRefFn,
  DiffFn,
  DiffNode,
  PatchFn,
  Snapshot,
  SyncData,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
  ValueNode,
} from './trimerge-sync-store';

function flatten<T>(array: T[][]): T[] {
  if (array.length === 0) {
    return [];
  }
  if (Array.length === 1) {
    return array[0];
  }
  return ([] as T[]).concat(...array);
}

export class TrimergeMemoryStore<State, EditMetadata, Delta>
  implements TrimergeSyncStore<State, EditMetadata, Delta> {
  private syncs: DiffNode<State, EditMetadata, Delta>[][] = [];
  private subscribers: SyncSubscriber<State, EditMetadata, Delta>[] = [];
  private nodes = new Map<string, DiffNode<State, EditMetadata, Delta>>();
  private snapshots = new Map<string, State>();
  private heads: Set<string> = [];
  private primary: string | undefined;

  constructor(
    public readonly diff: DiffFn<State, Delta>,
    public readonly patch: PatchFn<State, Delta>,
    public readonly reversePatch: PatchFn<State, Delta>,
    public readonly computeRef: ComputeRefFn<Delta, EditMetadata>,
  ) {}

  public async getSnapshot(): Promise<Snapshot<State, EditMetadata, Delta>> {
    return {
      syncCounter: this.syncs.length,
      node: this.getValueNode(this.primary),
    };
  }

  private getValueNode(
    targetRef: string | undefined,
  ): ValueNode<State, EditMetadata, Delta> | undefined {
    if (targetRef === undefined) {
      return undefined;
    }
    const node = this.nodes.get(targetRef);
    if (node === undefined) {
      return undefined;
    }
    const { editMetadata, delta, ref: ref, baseRef, baseRef2 } = node;
    const value =
      this.snapshots.get(targetRef) ??
      this.patch(this.getValueNode(baseRef)?.value, delta);

    return { ref, baseRef, baseRef2, editMetadata, value };
  }

  private addChild(parentRef: string | undefined, childRef: string) {
    if (parentRef !== undefined) {
      this.heads.delete(parentRef);
    }
    if (this.primary === parentRef) {
      this.primary = childRef;
    }
  }

  private addNodes(addNodes: DiffNode<State, EditMetadata, Delta>[]) {
    for (const node of addNodes) {
      if (this.nodes.has(node.ref)) {
        throw new Error(`attempting to add ref "${node.ref}" twice`);
      }
      this.heads.add(node.ref);
      this.addChild(node.baseRef, node.ref);
      this.addChild(node.baseRef2, node.ref);
    }
    this.syncs.push(addNodes);
    for (const subscriber of this.subscribers) {
      subscriber({ syncCounter: this.syncs.length, newNodes: addNodes });
    }
  }

  subscribe(
    lastSyncCounter: number,
    onSync: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn {
    this.subscribers.push(onSync);

    // Send everything new since lastSyncCounter
    if (this.syncs.length > lastSyncCounter) {
      const newNodes = flatten(this.syncs.slice(lastSyncCounter));
      if (newNodes.length > 0) {
        onSync({ syncCounter: this.syncs.length, newNodes });
      }
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      const index = this.subscribers.indexOf(onSync);
      if (index >= 0) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  public async sync(
    lastSyncCounter: number,
    addNodes?: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<SyncData<State, EditMetadata, Delta>> {
    const newNodes =
      this.syncs.length > lastSyncCounter
        ? flatten(this.syncs.slice(lastSyncCounter))
        : [];
    if (addNodes && addNodes.length > 0) {
      this.addNodes(addNodes);
    }
    return { syncCounter: this.syncs.length, newNodes };
  }
}
