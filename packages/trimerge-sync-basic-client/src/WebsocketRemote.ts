import type { ErrorCode, OnEventFn, Remote, SyncEvent } from 'trimerge-sync';

export class WebsocketRemote<EditMetadata, Delta, PresenceState>
  implements Remote<EditMetadata, Delta, PresenceState> {
  private socket: WebSocket | undefined;
  private bufferedEvents: SyncEvent<EditMetadata, Delta, PresenceState>[] = [];
  constructor(
    auth: unknown,
    lastSyncId: string | undefined,
    private readonly onEvent: OnEventFn<EditMetadata, Delta, PresenceState>,
    websocketUrl: string,
  ) {
    this.socket = new WebSocket(websocketUrl);
    onEvent({ type: 'remote-state', connect: 'connecting' });
    this.socket.onopen = () => {
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
    this.send({ type: 'init', lastSyncId, auth });
  }

  send(event: SyncEvent<EditMetadata, Delta, PresenceState>): void {
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
    this.socket.close(1000, 'shutdown');
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
}
