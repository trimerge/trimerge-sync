import invariant from 'invariant';
import {
  ErrorCode,
  Logger,
  OnRemoteEventFn,
  PrefixLogger,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from 'trimerge-sync';
import { IndexedDbCommitRepository } from 'trimerge-sync-indexed-db';

export class WebsocketRemote<CommitMetadata, Delta, Presence>
  implements Remote<CommitMetadata, Delta, Presence>
{
  private socket: WebSocket | undefined;
  private bufferedEventsToServer: SyncEvent<CommitMetadata, Delta, Presence>[] =
    [];
  private bufferedEventsToClient: SyncEvent<CommitMetadata, Delta, Presence>[] =
    [];
  private logger: Logger | undefined;
  private isShutdown = false;
  private onEvent: OnRemoteEventFn<CommitMetadata, Delta, Presence> | undefined;
  constructor(
    private readonly auth: unknown,
    private readonly commitRepo: IndexedDbCommitRepository<any, any, any>,
    private readonly websocketUrl: string,
  ) {}

  async connect({ lastSyncCursor }: RemoteSyncInfo): Promise<void> {
    this.logger?.log(`[TRIMERGE-SYNC] Connecting to ${this.websocketUrl}...`);
    this.socket = new WebSocket(this.websocketUrl);
    this.socket.onopen = () => {
      if (!this.socket) {
        this.logger?.warn(`[TRIMERGE-SYNC] Connected, but already shutdown...`);
        return;
      }
      this.logger?.log(`[TRIMERGE-SYNC] Connected to ${this.websocketUrl}`);
      this.emit({ type: 'remote-state', connect: 'online' });
      const events = this.bufferedEventsToServer;
      this.bufferedEventsToServer = [];
      for (const event of events) {
        this.send(event);
      }
    };
    this.socket.onclose = () => this.fail('closed', 'disconnected');
    this.socket.onerror = () => this.fail('error', 'network', false);
    this.socket.onmessage = (event) => {
      this.emit(JSON.parse(event.data));
    };

    const { localStoreId } = await this.commitRepo.dbInfo;

    this.send({
      type: 'init',
      version: 1,
      lastSyncCursor,
      localStoreId,
      auth: this.auth,
    });
  }

  listen(cb: OnRemoteEventFn<CommitMetadata, Delta, Presence>): void {
    invariant(!this.onEvent, 'listen() called twice');
    this.onEvent = cb;

    if (this.bufferedEventsToClient.length > 0) {
      const events = this.bufferedEventsToClient;
      this.bufferedEventsToClient = [];
      for (const event of events) {
        this.emit(event);
      }
    }
    this.bufferedEventsToClient = [];
  }

  get active() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  disconnect(): void | Promise<void> {
    if (
      !this.socket ||
      this.socket.readyState === WebSocket.CLOSING ||
      this.socket.readyState === WebSocket.CLOSED
    ) {
      return;
    }
    this.logger?.log(`Shutting down websocket ${this.socket.url}...`);
    this.socket.close(1000, 'shutdown');
    this.socket = undefined;
    this.emit({
      type: 'remote-state',
      connect: 'offline',
      read: 'offline',
    });
  }

  private emit(event: SyncEvent<CommitMetadata, Delta, Presence>) {
    if (this.onEvent) {
      this.onEvent(event);
    } else {
      this.bufferedEventsToClient.push(event);
    }
  }

  send(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
    invariant(this.socket, 'send() called on shutdown remote');
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.bufferedEventsToServer.push(event);
    } else {
      this.socket.send(JSON.stringify(event));
    }
  }

  shutdown(): void {
    invariant(!this.isShutdown, 'shutdown() called twice');
  }

  fail(message: string, code: ErrorCode, reconnect = true) {
    this.emit({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect,
    });
    this.shutdown();
  }

  configureLogger(logger: Logger): void {
    this.logger = new PrefixLogger('WEBSOCKET_REMOTE', logger);
  }
}
