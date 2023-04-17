import {
  AckCommitsEvent,
  Commit,
  CommitsEvent,
  ErrorCode,
  OnRemoteEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from '../types';
import { MemoryStore } from './MemoryStore';
import { PromiseQueue } from '../lib/PromiseQueue';

export class MemoryRemote<CommitMetadata, Delta, Presence>
  implements Remote<CommitMetadata, Delta, Presence>
{
  active = false;
  private readonly remoteQueue = new PromiseQueue();
  private closed = false;
  private onEvent: OnRemoteEventFn<CommitMetadata, Delta, Presence> | undefined;
  private eventBuffer: SyncEvent<CommitMetadata, Delta, Presence>[] = [];

  constructor(
    private readonly store: MemoryStore<CommitMetadata, Delta, Presence>,
    private readonly userId: string,
    private readonly clientStoreId: string,
  ) {}

  private emit(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
    if (this.onEvent) {
      this.onEvent(event);
    } else {
      this.eventBuffer.push(event);
    }
  }

  listen(cb: OnRemoteEventFn<CommitMetadata, Delta, Presence>): void {
    if (this.onEvent) {
      throw new Error('already listening');
    }
    if (this.eventBuffer.length > 0) {
      for (const event of this.eventBuffer) {
        cb(event);
      }
      this.eventBuffer = [];
    }
    this.onEvent = cb;
  }

  connect({ lastSyncCursor }: RemoteSyncInfo): void | Promise<void> {
    if (!this.store.online) {
      throw new Error('offline');
    }
    if (this.active) {
      return;
    }
    this.sendInitialEvents(lastSyncCursor).catch(
      this.handleAsError('internal'),
    );
    this.active = true;
  }

  disconnect(): void | Promise<void> {
    return;
  }

  configureLogger(): void {
    /* no-op */
  }

  private async handle(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    switch (event.type) {
      case 'commits':
        // FIXME: check for commits with wrong userId
        const ack = await this.addCommits(event.commits);
        this.emit(ack);
        await this.broadcast({ ...event, syncId: ack.syncId });
        break;

      case 'ready':
        // do nothing (for now)
        break;

      case 'client-join':
      case 'client-presence':
      case 'client-leave':
        await this.broadcast(event);
        break;
    }
  }

  send(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
    this.remoteQueue
      .add(() => this.handle(event))
      .catch(this.handleAsError('internal'));
  }

  private receive(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
    this.remoteQueue
      .add(async () => this.emit(event))
      .catch(this.handleAsError('internal'));
  }

  protected async sendInitialEvents(
    lastSyncCursor: string | undefined,
  ): Promise<void> {
    this.emit({ type: 'remote-state', connect: 'online' });

    for await (const event of this.getCommits(lastSyncCursor)) {
      this.emit(event);
    }
    this.emit({ type: 'ready' });
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.emit({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }

  fail(message: string, code: ErrorCode, reconnect = true) {
    this.emit({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect,
    });
    this.active = false;
  }

  protected handleAsError(code: ErrorCode) {
    return (error: Error) => this.fail(error.message, code);
  }
  protected addCommits(
    commits: readonly Commit<CommitMetadata, Delta>[],
  ): Promise<AckCommitsEvent<CommitMetadata>> {
    return this.store.addCommits(commits);
  }

  protected async broadcast(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
  ): Promise<void> {
    for (const remote of this.store.remotes) {
      // Don't send to other clients with the same userId/clientStoreId pair
      if (
        remote.userId === this.userId &&
        remote.clientStoreId === this.clientStoreId
      ) {
        continue;
      }
      remote.receive(event);
    }
  }

  protected async *getCommits(
    lastSyncCursor: string | undefined,
  ): AsyncIterableIterator<CommitsEvent<CommitMetadata, Delta, Presence>> {
    yield await this.store.getLocalCommitsEvent(lastSyncCursor);
  }
}
