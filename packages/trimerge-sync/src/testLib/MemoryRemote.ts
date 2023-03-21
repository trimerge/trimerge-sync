import {
  AckCommitsEvent,
  Commit,
  CommitsEvent,
  ErrorCode,
  Logger,
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
  private readonly remoteQueue = new PromiseQueue();
  private closed = false;

  constructor(
    private readonly store: MemoryStore<CommitMetadata, Delta, Presence>,
    private readonly userId: string,
    private readonly clientStoreId: string,
    { lastSyncCursor }: RemoteSyncInfo,
    private readonly onEvent: OnRemoteEventFn<CommitMetadata, Delta, Presence>,
  ) {
    this.sendInitialEvents(lastSyncCursor).catch(
      this.handleAsError('internal'),
    );
  }

  configureLogger(logger: Logger): void {
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
        await this.onEvent(ack);
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
      .add(async () => this.onEvent(event))
      .catch(this.handleAsError('internal'));
  }

  protected async sendInitialEvents(
    lastSyncCursor: string | undefined,
  ): Promise<void> {
    this.onEvent({ type: 'remote-state', connect: 'online' });

    for await (const event of this.getCommits(lastSyncCursor)) {
      this.onEvent(event);
    }
    this.onEvent({ type: 'ready' });
  }

  async shutdown(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onEvent({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }

  fail(message: string, code: ErrorCode, reconnect = true) {
    this.onEvent({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect,
    });
    void this.shutdown();
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
