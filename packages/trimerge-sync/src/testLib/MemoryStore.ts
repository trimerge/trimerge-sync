import {
  DiffNode,
  ErrorCode,
  GetLocalStoreFn,
  GetRemoteFn,
  NodesEvent,
  OnEventFn,
  SyncEvent,
} from '../types';
import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import { AbstractLocalStore } from '../AbstractLocalStore';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';
import { AbstractRemote } from '../AbstractRemote';

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

class MemoryLocalStore<
  EditMetadata,
  Delta,
  PresenceState
> extends AbstractLocalStore<EditMetadata, Delta, PresenceState> {
  private readonly channel: MemoryBroadcastChannel<
    SyncEvent<EditMetadata, Delta, PresenceState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, PresenceState>,
    userId: string,
    clientId: string,
    onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    getRemote?: GetRemoteFn<EditMetadata, Delta, PresenceState>,
  ) {
    super(userId, clientId, onEvent);
    this.channel = new MemoryBroadcastChannel(
      this.store.docId,
      this.onLocalBroadcastEvent,
    );
    if (getRemote) {
      this.channel
        .awaitLeadership()
        .then(() => this.connectRemote(getRemote))
        .catch(() => {
          // this happens if we close before becoming leader
        });
    }
    this.sendInitialEvents().catch(this.handleAsError('internal'));
  }

  protected addNodes(
    nodes: DiffNode<EditMetadata, Delta>[],
    remoteSyncId?: string,
  ): Promise<string> {
    return this.store.addNodes(nodes, remoteSyncId);
  }

  protected async acknowledgeRemoteNodes(
    refs: readonly string[],
    remoteSyncId: string,
  ): Promise<void> {
    await this.store.acknowledgeNodes(refs, remoteSyncId);
  }

  protected async broadcastLocal(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    await this.channel.postMessage(event);
  }

  protected async *getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    yield await this.store.getLocalNodesEvent();
  }

  protected async *getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, PresenceState>
  > {
    yield await this.store.getNodesEventForRemote();
  }

  protected getLastRemoteSyncId(): Promise<string | undefined> {
    return this.store.getLastRemoteSyncId();
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.channel.close();
  }
}

class MemoryRemote<EditMetadata, Delta, PresenceState> extends AbstractRemote<
  EditMetadata,
  Delta,
  PresenceState
> {
  private readonly channel: MemoryBroadcastChannel<
    SyncEvent<EditMetadata, Delta, PresenceState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, PresenceState>,
    userId: string,
    lastSyncId: string | undefined,
    onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
  ) {
    super(userId, onEvent);
    this.channel = new MemoryBroadcastChannel(this.store.docId, onEvent);
    this.sendInitialEvents(lastSyncId).catch(this.handleAsError('internal'));
  }

  protected addNodes(nodes: DiffNode<EditMetadata, Delta>[]): Promise<string> {
    return this.store.addNodes(nodes);
  }

  protected broadcast(
    event: SyncEvent<EditMetadata, Delta, PresenceState>,
  ): Promise<void> {
    return this.channel.postMessage(event);
  }

  protected async *getNodes(
    lastSyncId: string | undefined,
  ): AsyncIterableIterator<NodesEvent<EditMetadata, Delta, PresenceState>> {
    yield await this.store.getLocalNodesEvent(lastSyncId);
  }

  public fail(message: string, code: ErrorCode, reconnect?: boolean) {
    super.fail(message, code, reconnect);
  }

  async shutdown(): Promise<void> {
    await super.shutdown();
    this.channel.close();
  }
}
