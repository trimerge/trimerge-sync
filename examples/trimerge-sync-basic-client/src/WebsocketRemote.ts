import type {
  ErrorCode,
  OnRemoteEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from 'trimerge-sync';

export class WebsocketRemote<CommitMetadata, Delta, Presence>
  implements Remote<CommitMetadata, Delta, Presence>
{
  private socket: WebSocket | undefined;
  private bufferedEvents: SyncEvent<CommitMetadata, Delta, Presence>[] = [];
  constructor(
    auth: unknown,
    localStoreId: string,
    { lastSyncCursor }: RemoteSyncInfo,
    private readonly onEvent: OnRemoteEventFn<CommitMetadata, Delta, Presence>,
    websocketUrl: string,
  ) {
    console.log(`[TRIMERGE-SYNC] Connecting to ${websocketUrl}...`);
    this.socket = new WebSocket(websocketUrl);
    this.socket.onopen = () => {
      if (!this.socket) {
        console.warn(`[TRIMERGE-SYNC] Connected, but already shutdown...`);
        return;
      }
      console.log(`[TRIMERGE-SYNC] Connected to ${websocketUrl}`);
      onEvent({ type: 'remote-state', connect: 'online' });
      const events = this.bufferedEvents;
      this.bufferedEvents = [];
      for (const event of events) {
        this.send(event);
      }
    };
    this.socket.onclose = () => this.fail('closed', 'disconnected');
    this.socket.onerror = () => this.fail('error', 'network', false);
    this.socket.onmessage = (event) => {
      onEvent(JSON.parse(event.data));
    };
    this.send({
      type: 'init',
      version: 1,
      localStoreId,
      lastSyncCursor,
      auth,
    });
  }

  send(event: SyncEvent<CommitMetadata, Delta, Presence>): void {
    if (!this.socket) {
      return;
    }
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.bufferedEvents.push(event);
    } else {
      this.socket.send(JSON.stringify(event));
    }
  }

  shutdown(): void {
    if (!this.socket) {
      return;
    }
    if (this.socket.readyState !== WebSocket.CLOSED) {
      console.log(
        `[TRIMERGE-SYNC] Shutting down websocket ${this.socket.url}...`,
      );
      this.socket.close(1000, 'shutdown');
    }
    this.socket = undefined;
    this.onEvent({
      type: 'remote-state',
      connect: 'offline',
      read: 'offline',
    });
  }

  fail(message: string, code: ErrorCode, reconnect = true) {
    this.onEvent({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect,
    });
    this.shutdown();
  }

  configureLogger(): void {
    // noop
  }
}
