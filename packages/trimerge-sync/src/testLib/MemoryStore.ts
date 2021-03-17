import {
  BackendEvent,
  DiffNode,
  ErrorCode,
  GetLocalBackendFn,
  GetRemoteBackendFn,
  NodesEvent,
  OnEventFn,
} from '../types';
import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import { AbstractLocalBackend } from '../AbstractLocalBackend';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';
import { AbstractRemoteBackend } from '../AbstractRemoteBackend';

function getSyncCounter(syncId: string): number {
  return parseInt(syncId, 36);
}

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, CursorState> {
  public readonly localBackends: MemoryLocalBackend<
    EditMetadata,
    Delta,
    CursorState
  >[] = [];
  public readonly remoteBackends: MemoryRemoteBackend<
    EditMetadata,
    Delta,
    CursorState
  >[] = [];
  private nodes: DiffNode<EditMetadata, Delta>[] = [];
  private syncedNodes = new Set<string>();
  private lastRemoteSyncId: string | undefined;
  private queue = new PromiseQueue();

  constructor(
    public readonly docId: string = randomId(),
    private readonly getRemoteBackend?: GetRemoteBackendFn<
      EditMetadata,
      Delta,
      CursorState
    >,
  ) {}

  public getNodes(): readonly DiffNode<EditMetadata, Delta>[] {
    return this.nodes;
  }

  private get syncId(): string {
    return this.nodes.length.toString(36);
  }

  getLocalBackend: GetLocalBackendFn<EditMetadata, Delta, CursorState> = (
    userId,
    cursorId,
    onEvent,
  ) => {
    const be = new MemoryLocalBackend(
      this,
      userId,
      cursorId,
      onEvent,
      this.getRemoteBackend,
    );
    this.localBackends.push(be);
    return be;
  };
  getRemoteBackendFn: GetRemoteBackendFn<EditMetadata, Delta, CursorState> = (
    userId: string,
    lastSyncId,
    onEvent,
  ) => {
    const be = new MemoryRemoteBackend(this, userId, lastSyncId, onEvent);
    this.remoteBackends.push(be);
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
  ): Promise<NodesEvent<EditMetadata, Delta, CursorState>> {
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
    NodesEvent<EditMetadata, Delta, CursorState>
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

class MemoryLocalBackend<
  EditMetadata,
  Delta,
  CursorState
> extends AbstractLocalBackend<EditMetadata, Delta, CursorState> {
  private readonly channel: MemoryBroadcastChannel<
    BackendEvent<EditMetadata, Delta, CursorState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, CursorState>,
    userId: string,
    cursorId: string,
    onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
    getRemoteBackend?: GetRemoteBackendFn<EditMetadata, Delta, CursorState>,
  ) {
    super(userId, cursorId, onEvent);
    this.channel = new MemoryBroadcastChannel(
      this.store.docId,
      this.onLocalBroadcastEvent,
    );
    if (getRemoteBackend) {
      this.channel
        .awaitLeadership()
        .then(() => this.connectRemote(getRemoteBackend))
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
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    await this.channel.postMessage(event);
  }

  protected async *getLocalNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
  > {
    yield await this.store.getLocalNodesEvent();
  }

  protected async *getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
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

class MemoryRemoteBackend<
  EditMetadata,
  Delta,
  CursorState
> extends AbstractRemoteBackend<EditMetadata, Delta, CursorState> {
  private readonly channel: MemoryBroadcastChannel<
    BackendEvent<EditMetadata, Delta, CursorState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, CursorState>,
    userId: string,
    lastSyncId: string | undefined,
    onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
  ) {
    super(userId, onEvent);
    this.channel = new MemoryBroadcastChannel(this.store.docId, onEvent);
    this.sendInitialEvents(lastSyncId).catch(this.handleAsError('internal'));
  }

  protected addNodes(nodes: DiffNode<EditMetadata, Delta>[]): Promise<string> {
    return this.store.addNodes(nodes);
  }

  protected broadcast(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    return this.channel.postMessage(event);
  }

  protected async *getNodes(
    lastSyncId: string | undefined,
  ): AsyncIterableIterator<NodesEvent<EditMetadata, Delta, CursorState>> {
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
