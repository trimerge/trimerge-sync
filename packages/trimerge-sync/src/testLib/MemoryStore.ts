import { DiffNode, GetLocalStoreFn, GetRemoteFn, NodesEvent } from '../types';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';
import { MemoryLocalStore } from './MemoryLocalStore';
import { MemoryRemote } from './MemoryRemote';

function getSyncCounter(syncId: string): number {
  return parseInt(syncId, 36);
}

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, PresenceState> {
  public readonly remotes: MemoryRemote<
    EditMetadata,
    Delta,
    PresenceState
  >[] = [];
  private nodes: DiffNode<EditMetadata, Delta>[] = [];
  private syncedNodes = new Set<string>();
  private lastRemoteSyncId: string | undefined;
  private queue = new PromiseQueue();

  constructor(
    public readonly docId: string = randomId(),
    private readonly getRemoteFn?: GetRemoteFn<
      EditMetadata,
      Delta,
      PresenceState
    >,
  ) {}

  public getNodes(): readonly DiffNode<EditMetadata, Delta>[] {
    return this.nodes;
  }

  private get syncId(): string {
    return this.nodes.length.toString(36);
  }

  getLocalStore: GetLocalStoreFn<EditMetadata, Delta, PresenceState> = (
    userId,
    clientId,
    onEvent,
  ) => {
    return new MemoryLocalStore(
      this,
      userId,
      clientId,
      onEvent,
      this.getRemoteFn,
    );
  };
  getRemote: GetRemoteFn<EditMetadata, Delta, PresenceState> = (
    userId: string,
    lastSyncId,
    onEvent,
  ) => {
    const be = new MemoryRemote(this, userId, lastSyncId, onEvent);
    this.remotes.push(be);
    return be;
  };

  addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<string> {
    return this.queue.add(async () => {
      this.nodes.push(...nodes);
      if (remoteSyncId !== undefined) {
        for (const { ref } of nodes) {
          this.syncedNodes.add(ref);
        }
        this.lastRemoteSyncId = remoteSyncId;
      }
      return this.syncId;
    });
  }
  async acknowledgeNodes(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void> {
    return this.queue.add(async () => {
      for (const ref of refs) {
        this.syncedNodes.add(ref);
      }
      this.lastRemoteSyncId = remoteSyncId;
    });
  }

  getLocalNodesEvent(
    startSyncId?: string,
  ): Promise<NodesEvent<EditMetadata, Delta, PresenceState>> {
    return this.queue.add(async () => ({
      type: 'nodes',
      nodes:
        startSyncId !== undefined
          ? this.nodes.slice(getSyncCounter(startSyncId))
          : this.nodes,
      syncId: this.syncId,
    }));
  }
  getLastRemoteSyncId(): Promise<string | undefined> {
    return this.queue.add(async () => this.lastRemoteSyncId);
  }

  getNodesEventForRemote(): Promise<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    return this.queue.add(async () => {
      const nodes = await this.nodes.filter(
        ({ ref }) => !this.syncedNodes.has(ref),
      );
      return {
        type: 'nodes',
        nodes,
        syncId: this.syncId,
      };
    });
  }
}
