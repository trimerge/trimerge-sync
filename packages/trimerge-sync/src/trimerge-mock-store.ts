import {
  DiffNode,
  Snapshot,
  SyncData,
  SyncSubscriber,
  TrimergeSyncStore,
  UnsubscribeFn,
  ValueNode,
} from './trimerge-sync-store';
import { Differ } from './differ';
import { waitMs } from './wait-promise';

export class TrimergeMockStore<State, EditMetadata, Delta>
  implements TrimergeSyncStore<State, EditMetadata, Delta> {
  private syncs: DiffNode<State, EditMetadata, Delta>[] = [];
  private subscribers = new Map<
    SyncSubscriber<State, EditMetadata, Delta>,
    number
  >();
  private nodes = new Map<string, DiffNode<State, EditMetadata, Delta>>();
  private snapshots = new Map<string, State>();
  private primary: string | undefined;

  constructor(private readonly differ: Differ<State, EditMetadata, Delta>) {}

  public async getSnapshot(): Promise<Snapshot<State, EditMetadata, Delta>> {
    return {
      syncCounter: this.syncs.length,
      node: this.getValueNode(this.primary),
      nodes: [],
    };
  }

  private getValueNode(
    targetRef: string | undefined,
  ): ValueNode<State, EditMetadata> | undefined {
    if (targetRef === undefined) {
      return undefined;
    }
    const node = this.nodes.get(targetRef);
    if (node === undefined) {
      return undefined;
    }
    const { ref, baseRef, mergeRef, editMetadata, delta } = node;
    const value =
      this.snapshots.get(targetRef) ??
      this.differ.patch(this.getValueNode(baseRef)?.value, delta);

    return { ref, baseRef, mergeRef, editMetadata, value };
  }

  private addChild(parentRef: string | undefined, childRef: string) {
    if (this.primary === parentRef) {
      this.primary = childRef;
    }
  }

  subscribe(
    lastSyncCounter: number,
    onSync: SyncSubscriber<State, EditMetadata, Delta>,
  ): UnsubscribeFn {
    this.sendToSubscriber(onSync, lastSyncCounter);

    let unsubscribed = false;
    return () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      this.subscribers.delete(onSync);
    };
  }

  private sendToSubscriber(
    onSync: SyncSubscriber<State, EditMetadata, Delta>,
    lastSyncCounter: number,
  ) {
    // Send everything new since lastSyncCounter
    const syncCounter = this.syncs.length;
    if (syncCounter > lastSyncCounter) {
      const newNodes = this.syncs.slice(lastSyncCounter);
      if (newNodes.length > 0) {
        onSync({ syncCounter, newNodes });
      }
    }
    this.subscribers.set(onSync, syncCounter);
  }

  public sendToSubscribers() {
    for (const [subscriber, lastSyncCounter] of this.subscribers.entries()) {
      this.sendToSubscriber(subscriber, lastSyncCounter);
    }
  }

  public async addNodes(
    newNodes: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<number> {
    if (newNodes.length > 0) {
      for (const node of newNodes) {
        if (this.nodes.has(node.ref)) {
          continue;
        }
        this.addChild(node.baseRef, node.ref);
        this.addChild(node.mergeRef, node.ref);
        this.nodes.set(node.ref, node);
        this.syncs.push(node);
      }
    }
    return this.syncs.length;
  }
}
