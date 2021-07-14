import {
  AckNodesEvent,
  DiffNode,
  GetLocalStoreFn,
  GetRemoteFn,
  NodesEvent,
  RemoteSyncInfo,
} from '../types';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';
import { MemoryLocalStore } from './MemoryLocalStore';
import { MemoryRemote } from './MemoryRemote';

function getSyncCounter(syncCursor: string): number {
  return parseInt(syncCursor, 36);
}

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, PresenceState> {
  public readonly remotes: MemoryRemote<EditMetadata, Delta, PresenceState>[] =
    [];
  private nodes: DiffNode<EditMetadata, Delta>[] = [];
  private localNodeRefs = new Set<string>();
  private syncedNodes = new Set<string>();
  private readonly localStoreId = randomId();
  private lastRemoteSyncCursor: string | undefined;
  private queue = new PromiseQueue();
  private readonly localStores: MemoryLocalStore<
    EditMetadata,
    Delta,
    PresenceState
  >[] = [];

  public writeErrorMode = false;

  constructor(
    public readonly channelName: string = randomId(),
    private readonly getRemoteFn?: GetRemoteFn<
      EditMetadata,
      Delta,
      PresenceState
    >,
    public online = true,
  ) {}

  public getNodes(): readonly DiffNode<EditMetadata, Delta>[] {
    return this.nodes;
  }

  private get syncCursor(): string {
    return this.nodes.length.toString(36);
  }

  public set remoteNetworkPaused(paused: boolean) {
    for (const remote of this.remotes) {
      remote.channel.paused = paused;
    }
  }
  public set localNetworkPaused(paused: boolean) {
    for (const local of this.localStores) {
      local.channel.paused = paused;
    }
  }

  getLocalStore: GetLocalStoreFn<EditMetadata, Delta, PresenceState> = (
    userId,
    clientId,
    onEvent,
  ) => {
    const store = new MemoryLocalStore(
      this,
      userId,
      clientId,
      onEvent,
      this.getRemoteFn,
    );
    this.localStores.push(store);
    return store;
  };

  getRemote: GetRemoteFn<EditMetadata, Delta, PresenceState> = (
    userId: string,
    { lastSyncCursor },
    onEvent,
  ) => {
    if (!this.online) {
      throw new Error('offline');
    }
    const be = new MemoryRemote(this, userId, lastSyncCursor, onEvent);
    this.remotes.push(be);
    return be;
  };

  addNodes(
    nodes: readonly DiffNode<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<AckNodesEvent> {
    return this.queue.add(async () => {
      const refs = new Set<string>();
      for (const node of nodes) {
        const { ref } = node;
        if (!this.localNodeRefs.has(ref)) {
          this.nodes.push(node);
          this.localNodeRefs.add(ref);
        }
        refs.add(ref);
      }
      if (remoteSyncId !== undefined) {
        for (const { ref } of nodes) {
          this.syncedNodes.add(ref);
        }
        this.lastRemoteSyncCursor = remoteSyncId;
      }
      return {
        type: 'ack',
        refs: Array.from(refs),
        syncId: this.syncCursor,
      };
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
      this.lastRemoteSyncCursor = remoteSyncId;
    });
  }

  getLocalNodesEvent(
    startSyncCursor?: string,
  ): Promise<NodesEvent<EditMetadata, Delta, PresenceState>> {
    return this.queue.add(async () => ({
      type: 'nodes',
      nodes:
        startSyncCursor !== undefined
          ? this.nodes.slice(getSyncCounter(startSyncCursor))
          : this.nodes,
      syncId: this.syncCursor,
    }));
  }
  getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return this.queue.add(async () => ({
      localStoreId: this.localStoreId,
      lastSyncCursor: this.lastRemoteSyncCursor,
    }));
  }

  async *getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    const nodes = await this.queue.add(async () =>
      this.nodes.filter(({ ref }) => !this.syncedNodes.has(ref)),
    );
    const BATCH_SIZE = 5;
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      yield {
        type: 'nodes',
        nodes: nodes.slice(i, i + BATCH_SIZE),
      };
    }
  }

  async shutdown(): Promise<void> {
    return await this.queue.add(async () => {
      for (const remote of this.remotes) {
        await remote.shutdown();
      }
      for (const local of this.localStores) {
        await local.shutdown();
      }
    });
  }
}
