import {
  BackendEvent,
  DiffNode,
  GetSyncBackendFn,
  NodesEvent,
  OnEventFn,
} from '../TrimergeSyncBackend';
import { MemoryBroadcastChannel } from './MemoryBroadcastChannel';
import { AbstractSyncBackend } from '../AbstractSyncBackend';
import generate from 'project-name-generator';
import { PromiseQueue } from '../lib/PromiseQueue';

// function getSyncCounter(syncId: string): number {
//   return parseInt(syncId, 36);
// }

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, CursorState> {
  private nodes: DiffNode<EditMetadata, Delta>[] = [];
  private syncedNodes = new Set<string>();
  private lastRemoteSyncId: string | undefined;
  private queue = new PromiseQueue();

  constructor(
    public readonly docId: string = randomId(),
    private readonly getRemoteBackend?: GetSyncBackendFn<
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

  getSyncBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState> = (
    userId,
    cursorId,
    lastSyncId,
    onEvent,
  ) => {
    return new MemoryBackendSync(
      this,
      userId,
      cursorId,
      lastSyncId,
      onEvent,
      this.getRemoteBackend,
    );
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

  getInitialNodesEvent(): Promise<
    NodesEvent<EditMetadata, Delta, CursorState>
  > {
    return this.queue.add(async () => ({
      type: 'nodes',
      nodes: this.nodes,
      syncId: this.syncId,
    }));
  }
  getLastRemoteSyncId(): Promise<string | undefined> {
    return this.queue.add(async () => this.lastRemoteSyncId);
  }

  getUnsyncedNodesEvent(): Promise<
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

class MemoryBackendSync<
  EditMetadata,
  Delta,
  CursorState
> extends AbstractSyncBackend<EditMetadata, Delta, CursorState> {
  private readonly channel: MemoryBroadcastChannel<
    BackendEvent<EditMetadata, Delta, CursorState>
  >;

  constructor(
    private readonly store: MemoryStore<EditMetadata, Delta, CursorState>,
    userId: string,
    cursorId: string,
    lastSyncId: string | undefined,
    onEvent: OnEventFn<EditMetadata, Delta, CursorState>,
    getRemoteBackend?: GetSyncBackendFn<EditMetadata, Delta, CursorState>,
  ) {
    super(userId, cursorId, onEvent);
    this.channel = new MemoryBroadcastChannel<
      BackendEvent<EditMetadata, Delta, CursorState>
    >(this.store.docId, this.onLocalBroadcastEvent);
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

  protected async *getInitialNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
  > {
    yield await this.store.getInitialNodesEvent();
  }

  protected async *getUnsyncedNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
  > {
    yield await this.store.getUnsyncedNodesEvent();
  }

  protected getLastRemoteSyncId(): Promise<string | undefined> {
    return this.store.getLastRemoteSyncId();
  }

  async close(): Promise<void> {
    await super.close();
    this.channel.close();
  }
}
