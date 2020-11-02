import {
  DiffNode,
  SyncSubscriber,
  Snapshot,
  SyncData,
  TrimergeSyncStore,
  UnsubscribeFn,
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

  async getSnapshot(): Promise<Snapshot<State, EditMetadata, Delta>> {
    return {
      syncCounter: this.syncs.length,
      nodes: flatten(this.syncs),
    };
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

  async sync(
    lastSyncCounter: number,
    addNodes?: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<SyncData<State, EditMetadata, Delta>> {
    const newNodes =
      this.syncs.length > lastSyncCounter
        ? flatten(this.syncs.slice(lastSyncCounter))
        : [];
    if (addNodes && addNodes.length > 0) {
      this.syncs.push(addNodes);
      for (const subscriber of this.subscribers) {
        subscriber({ syncCounter: this.syncs.length, newNodes: addNodes });
      }
    }
    return { syncCounter: this.syncs.length, newNodes };
  }
}
