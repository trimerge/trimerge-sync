import {
  DiffNode,
  DiffNodeSubscriber,
  InitialState,
  SyncResult,
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
  private subscribers: DiffNodeSubscriber<State, EditMetadata, Delta>[] = [];

  async initialize(): Promise<InitialState<State, EditMetadata, Delta>> {
    return {
      syncCounter: this.syncs.length,
      nodes: flatten(this.syncs),
    };
  }

  async subscribe(
    onDiffNodes: DiffNodeSubscriber<State, EditMetadata, Delta>,
  ): Promise<UnsubscribeFn> {
    this.subscribers.push(onDiffNodes);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) {
        return;
      }
      unsubscribed = true;
      const index = this.subscribers.indexOf(onDiffNodes);
      if (index >= 0) {
        this.subscribers.splice(index, 1);
      }
    };
  }

  async sync(
    lastSyncCounter: number,
    addNodes?: DiffNode<State, EditMetadata, Delta>[],
  ): Promise<SyncResult<State, EditMetadata, Delta>> {
    const newNodes =
      this.syncs.length > lastSyncCounter
        ? flatten(this.syncs.slice(lastSyncCounter))
        : [];
    if (addNodes && addNodes.length > 0) {
      this.syncs.push(addNodes);
    }
    return { syncCounter: this.syncs.length, newNodes };
  }
}
