import {
  AckCommitsEvent,
  Commit,
  CommitsEvent,
  ErrorCode,
  Loggable,
  Logger,
  OnRemoteEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from '../types';
import { MemoryStore } from './MemoryStore';
import { PromiseQueue } from '../lib/PromiseQueue';
import { PrefixLogger } from '../lib/PrefixLogger';
import invariant from 'invariant';

type ClientInfo = {
    userId: string;
    clientId: string;
}

/** MemoryRemote represents a single connection to a remote store. */
export class MemoryRemote<CommitMetadata, Delta, Presence> implements Remote<CommitMetadata, Delta, Presence> {
    private logger: Logger | undefined;
    private eventBuffer: SyncEvent<CommitMetadata, Delta, Presence>[] = [];
    private onEvent: OnRemoteEventFn<CommitMetadata, Delta, Presence> | undefined;
    active: boolean = false;
    private isShutdown = false;
    private connectedPromise: Promise<void> | undefined;
    private connectedResolve: (() => void) | undefined;

    constructor(private readonly parent: MemoryServer<CommitMetadata, Delta, Presence>, readonly clientInfo: ClientInfo, public online: boolean = true) {}

    send(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
        invariant(!this.isShutdown, 'send() called after shutdown');
        this.parent.send(event, this.clientInfo);
    }

    async connect(syncInfo: RemoteSyncInfo): Promise<void> {
        invariant(!this.isShutdown, 'connect() called after shutdown');
        invariant(this.online, 'could not connect');
          if (this.active) {
            return;
          }
          await this.sendInitialEvents(syncInfo.lastSyncCursor).catch(
            this.handleAsError('internal'),
          );
        this.active = true;
        if (this.connectedResolve) {
            this.connectedResolve();
            this.connectedResolve = undefined;
            this.connectedPromise = undefined;
        }
    }

    onConnected(): Promise<void> {
        if (this.active) {
            return Promise.resolve();
        }
        if (!this.connectedPromise) {
            this.connectedPromise = new Promise((resolve) => {
                this.connectedResolve = resolve;
            });
        }
        return this.connectedPromise;
    }

    protected handleAsError(code: ErrorCode) {
        return (error: Error) => this.fail(error.message, code);
      }

    listen(cb: OnRemoteEventFn<CommitMetadata, Delta, Presence>): void {
        invariant(!this.onEvent, 'listen() called twice');
        if (this.eventBuffer.length > 0) {
          for (const event of this.eventBuffer) {
            cb(event);
          }
          this.eventBuffer = [];
        }
        this.onEvent = cb;
      }


    disconnect(): void {
        this.active = false;
        this.emit({type: 'remote-state', connect: 'offline'})
    }

    shutdown(): void {
        invariant(!this.isShutdown, 'shutdown() called twice');
        this.isShutdown = true;
        this.disconnect();
    }

    async sendInitialEvents(
        lastSyncCursor: string | undefined,
      ): Promise<void> {
        this.emit({ type: 'remote-state', connect: 'online' });

        for await (const event of this.parent.getCommits(lastSyncCursor)) {
          this.emit(event);
        }
        this.emit({ type: 'ready' });
      }

    emit(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
        this.logger?.event?.({
            type: 'send-event',
            sourceId: 'remote',
            payload: {
                recipientId: `COORDINATING_LOCAL_STORE:${this.clientInfo.clientId}`,
                event,
            }
        });
        if (this.onEvent) {
          this.onEvent(event);
        } else {
          this.eventBuffer.push(event);
        }
      }

      configureLogger(logger?: Logger): void {
        if (logger) {
            this.logger = new PrefixLogger('MEMORY_REMOTE', logger);
        } else {
            this.logger = undefined;
        }
      }

    fail(message: string, code: ErrorCode, reconnect = true): void {
        this.emit({
          type: 'error',
          code,
          message,
          fatal: true,
          reconnect,
        });
      }
}

/** MemoryServer represents a singleton entity that can receive commits.
 *  You can use it to create MemoryRemotes that can be provided to a LocalStore.
 */
export class MemoryServer<CommitMetadata, Delta, Presence>
implements Loggable
{
  private closed = false;
  private logger: Logger | undefined;
  public readonly remoteMap = new Map<string,MemoryRemote<CommitMetadata, Delta, Presence>>();
  private readonly serverQueue = new PromiseQueue();

  constructor(
    readonly store: MemoryStore<CommitMetadata, Delta, Presence>,
  ) {}

  /** Produces a remote that corresponds with this "server" */
  remote(clientInfo: ClientInfo, online = true): MemoryRemote<CommitMetadata, Delta, Presence> {
    const clientKey = this.getClientKey(clientInfo);
    if (this.remoteMap.has(clientKey)) {
        throw new Error(`A remote with userId ${clientInfo.userId} and clientId ${clientInfo.clientId} has already been created.`);
    }
    const remote = new MemoryRemote(this, clientInfo, online);
    this.remoteMap.set(clientKey, remote);
    return remote;
  }

  private getClientKey(clientInfo: ClientInfo): string {
    return `${clientInfo.userId}:${clientInfo.clientId}`;
  }

  configureLogger(logger?: Logger): void {
    if (logger) {
        this.logger = new PrefixLogger('MEMORY_SERVER', logger);
    } else {
        this.logger = undefined;
    }
  }

  emit(event: SyncEvent<CommitMetadata, Delta, Presence>, recipientClientInfo: ClientInfo): void {
    const remote = this.remoteMap.get(this.getClientKey(recipientClientInfo));
    invariant(remote, `No remote found for userId ${recipientClientInfo.userId} and clientId ${recipientClientInfo.clientId}`);
    remote.emit(event);
  }

  private async handle(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    senderClientInfo: ClientInfo,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    this.logger?.event?.({
        type: 'receive-event',
        sourceId: 'remote',
        payload: {
            event,
        },
    });
    switch (event.type) {
      case 'commits':
        // FIXME: check for commits with wrong userId
        const ack = await this.addCommits(event.commits);
        this.emit(ack, senderClientInfo);
        // We send commits back to all clients, including the sender.
        await this.broadcast({ ...event, syncId: ack.syncId });
        break;

      case 'ready':
        // do nothing (for now)
        break;

      case 'client-join':
      case 'client-presence':
      case 'client-leave':
        await this.broadcast(event, senderClientInfo);
        break;
    }
  }

  send(event: SyncEvent<CommitMetadata, Delta, Presence>, senderClientInfo: ClientInfo): void {
    this.serverQueue
      .add(() => this.handle(event, senderClientInfo))
      .catch(this.handleAsError('internal', senderClientInfo));
  }

  private fail(message: string, code: ErrorCode, senderClientInfo: ClientInfo) {
    this.emit({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect: true,
    }, senderClientInfo);
  }

  protected handleAsError(code: ErrorCode, senderClientInfo: ClientInfo) {
    return (error: Error) => this.fail(error.message, code, senderClientInfo);
  }
  protected addCommits(
    commits: readonly Commit<CommitMetadata, Delta>[],
  ): Promise<AckCommitsEvent<CommitMetadata>> {
    return this.store.addCommits(commits);
  }

  protected async broadcast(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    senderClientInfo?: ClientInfo,
  ): Promise<void> {
    for (const [clientKey, remote] of this.remoteMap.entries()) {
      // Don't send to other clients with the same userId/clientId pair
      if (
        senderClientInfo && this.getClientKey(senderClientInfo) === clientKey
      ) {
        continue;
      }
      remote.emit(event);
    }
  }

  async *getCommits(
    lastSyncCursor: string | undefined,
  ): AsyncIterableIterator<CommitsEvent<CommitMetadata, Delta, Presence>> {
    yield await this.store.getLocalCommitsEvent(lastSyncCursor);
  }
}
