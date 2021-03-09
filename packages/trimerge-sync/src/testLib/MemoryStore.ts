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

// function getSyncCounter(syncId: string): number {
//   return parseInt(syncId, 36);
// }

function randomId() {
  return generate({ words: 3, alliterative: true }).dashed;
}

export class MemoryStore<EditMetadata, Delta, CursorState> {
  private nodes: DiffNode<EditMetadata, Delta>[] = [];

  constructor(public readonly docId: string = randomId()) {}

  public getNodes(): readonly DiffNode<EditMetadata, Delta>[] {
    return this.nodes;
  }

  public get syncId(): string {
    return this.nodes.length.toString(36);
  }

  getSyncBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState> = (
    userId,
    cursorId,
    lastSyncId,
    onEvent,
  ) => {
    return new MemoryBackendSync(this, userId, cursorId, lastSyncId, onEvent);
  };

  async addNodes(nodes: DiffNode<EditMetadata, Delta>[]): Promise<void> {
    this.nodes.push(...nodes);
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
  ) {
    super(userId, cursorId, onEvent);
    this.channel = new MemoryBroadcastChannel<
      BackendEvent<EditMetadata, Delta, CursorState>
    >(this.store.docId, this.onBroadcastReceive);
    this.sendInitialEvents().catch(this.handleAsError('internal'));
  }

  protected async addNodes(
    nodes: DiffNode<EditMetadata, Delta>[],
  ): Promise<string> {
    await this.store.addNodes(nodes);
    return this.store.syncId;
  }

  async broadcast(
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ): Promise<void> {
    await this.channel.postMessage(event);
  }

  protected async *getInitialNodes(): AsyncIterableIterator<
    NodesEvent<EditMetadata, Delta, CursorState>
  > {
    yield {
      type: 'nodes',
      nodes: this.store.getNodes(),
      syncId: this.store.syncId,
    };
  }

  async close(): Promise<void> {
    await super.close();
    this.channel.close();
  }
}
