import {
  BackendEvent,
  CursorInfo,
  DiffNode,
  GetSyncBackendFn,
  OnEventFn,
} from '../TrimergeSyncBackend';
import { PromiseQueue } from '../lib/PromiseQueue';
import { getFullId } from '../util';

function getSyncCounter(syncId: string): number {
  return parseInt(syncId, 36);
}

export class MemoryStore<EditMetadata, Delta, CursorState> {
  private nodes: DiffNode<EditMetadata, Delta>[] = [];
  private cursors = new Map<
    string,
    {
      info: CursorInfo<CursorState>;
      onEvent: OnEventFn<EditMetadata, Delta, CursorState>;
    }
  >();
  private queue = new PromiseQueue();

  public getNodes(): readonly DiffNode<EditMetadata, Delta>[] {
    return this.nodes;
  }

  private get syncId(): string {
    return this.nodes.length.toString(36);
  }

  private broadcast(
    fromUserCursor: string,
    event: BackendEvent<EditMetadata, Delta, CursorState>,
  ) {
    for (const [userCursor, { onEvent }] of this.cursors.entries()) {
      if (userCursor !== fromUserCursor) {
        onEvent(event);
      }
    }
  }

  getSyncBackend: GetSyncBackendFn<EditMetadata, Delta, CursorState> = (
    userId,
    cursorId,
    lastSyncId,
    onEvent,
  ) => {
    let closed = false;

    const userCursor = getFullId(userId, cursorId);
    if (this.cursors.has(userCursor)) {
      throw new Error('userId/cursorId already connected');
    }
    this.queue.add(async () => {
      const syncId = this.syncId;
      const lastSyncCounter = lastSyncId ? getSyncCounter(lastSyncId) : 0;
      if (lastSyncCounter > this.nodes.length) {
        onEvent({
          type: 'error',
          code: 'invalid-sync-id',
          disconnected: true,
        });
        closed = true;
        return;
      }
      const nodes = this.nodes.slice(lastSyncCounter);
      onEvent({
        type: 'nodes',
        nodes,
        syncId,
      });
      onEvent({
        type: 'cursors',
        cursors: Array.from(this.cursors.values()).map(({ info }) => info),
      });
      this.cursors.set(userCursor, {
        info: { userId, cursorId, state: undefined },
        onEvent,
      });
      this.broadcast(userCursor, {
        type: 'cursor-join',
        userId,
        cursorId,
        state: undefined,
      });
    });

    return {
      sendNodes: (nodes): void => {
        if (closed) {
          throw new Error('already closed');
        }
        void this.queue.add(async () => {
          this.nodes.push(...nodes);
          const syncId = this.syncId;
          this.broadcast(userCursor, {
            type: 'nodes',
            nodes,
            syncId,
          });
          onEvent({
            type: 'ack',
            refs: nodes.map(({ ref }) => ref),
            syncId,
          });
        });
      },

      close: async () => {
        if (closed) {
          throw new Error('already closed');
        }
        await this.queue.add(async () => {
          this.cursors.delete(userCursor);
          closed = true;
          this.broadcast(userCursor, {
            type: 'cursor-leave',
            userId,
            cursorId,
          });
        });
      },
    };
  };
}