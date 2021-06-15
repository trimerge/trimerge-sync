import type WebSocket from 'ws';
import type { ErrorCode, SyncEvent } from 'trimerge-sync';
import { PromiseQueue } from 'trimerge-sync';
import type { LiveDoc } from './docs';
import type { Authenticated, AuthenticateFn } from '../types';
import { LogFn } from '../types';
import { InternalError, MessageTooBig, UnsupportedData } from './codes';

export class Connection {
  private readonly clients = new Set<string>();
  private readonly queue = new PromiseQueue();
  private authenticated?: Authenticated = undefined;

  constructor(
    private readonly id: string,
    private readonly ws: WebSocket,
    private readonly docId: string,
    private readonly liveDoc: LiveDoc,
    private readonly authenticate: AuthenticateFn,
    private readonly onClose: () => void,
    private readonly logDebug: LogFn,
    private readonly logInfo: LogFn,
    private readonly logWarn: LogFn,
  ) {
    ws.on('close', () => {
      this.logInfo('socket closed', { connId: this.id });
      this.queue
        .add(async () => this.onClosed())
        .catch((error) => {
          this.closeWithCode(
            InternalError,
            'internal',
            `internal error: ${error}`,
          );
        });
    });
    ws.on('message', (message) => {
      if (typeof message !== 'string') {
        this.closeWithCode(UnsupportedData, 'bad-request', 'unsupported data');
        return;
      }
      if (message.length > 1_000_000) {
        this.closeWithCode(MessageTooBig, 'bad-request', 'payload too big');
        return;
      }
      this.logDebug(`--> received ${message}`, { connId: this.id });
      this.queue.add(() => this.onMessage(message));
    });
  }

  private async sendInitialEvents(
    lastSyncId: string | undefined,
  ): Promise<void> {
    const event = await this.liveDoc.store.getNodesEvent(lastSyncId);
    if (event.nodes.length > 0) {
      this.sendEvent(event);
    }
    this.sendEvent({ type: 'ready' });
  }

  private async onMessage(message: string): Promise<void> {
    let data: SyncEvent<unknown, unknown, unknown>;
    try {
      data = JSON.parse(message);
    } catch (e) {
      this.closeWithCode(UnsupportedData, 'bad-request', 'invalid json');
      return;
    }
    if (data.type === 'init') {
      if (this.authenticated) {
        this.sendEvent({
          type: 'error',
          code: 'bad-request',
          message: 'already authenticated',
          fatal: false,
        });
        return;
      }
      const { auth, lastSyncId } = data;
      this.authenticated = await this.authenticate(this.docId, auth);
      this.logInfo(`initialize`, {
        connId: this.id,
        docId: this.docId,
        userId: this.authenticated.userId,
        lastSyncId,
      });
      await this.sendInitialEvents(lastSyncId);
      return;
    }

    if (!this.authenticated) {
      this.closeWithCode(UnsupportedData, 'unauthorized', 'unauthorized');
      return;
    }

    switch (data.type) {
      case 'nodes': {
        const response = await this.liveDoc.addNodes(data);
        this.sendEvent(response);
        this.broadcastEvent({ ...data, syncId: response.syncId });
        break;
      }

      case 'client-join':
      case 'client-presence': {
        const { userId, clientId } = data.info;
        if (userId !== this.authenticated.userId) {
          this.closeWithCode(
            UnsupportedData,
            'bad-request',
            'userId does not match',
          );
          return;
        }
        this.broadcast(message);
        if (!this.clients.has(clientId)) {
          this.logDebug('adding clientId', { connId: this.id, clientId });
          this.clients.add(clientId);
        }
        break;
      }

      case 'client-leave': {
        const { userId, clientId } = data;
        if (userId !== this.authenticated.userId) {
          this.closeWithCode(
            UnsupportedData,
            'bad-request',
            'userId does not match',
          );
          return;
        }
        if (!this.clients.has(clientId)) {
          this.closeWithCode(
            UnsupportedData,
            'bad-request',
            'client-leave for unknown clientId',
          );
          return;
        }
        this.broadcast(message);
        this.logDebug(`removing clientId`, { connId: this.id, clientId });
        this.clients.delete(clientId);
        break;
      }

      case 'ready':
      case 'remote-state':
      case 'ack':
      case 'error': {
        this.logWarn(`ignoring command ${data.type}`, { connId: this.id });
        // this.closeWithCode(UnsupportedData, 'unexpected event');
        return;
      }
    }
  }

  private broadcastEvent(event: SyncEvent<unknown, unknown, unknown>) {
    this.broadcast(JSON.stringify(event));
  }

  private sendEvent(event: SyncEvent<unknown, unknown, unknown>) {
    this.send(JSON.stringify(event));
  }

  private broadcast(message: string) {
    this.liveDoc.broadcast(this, message);
  }

  public send(message: string) {
    this.logDebug(`<-- sending: ${message}`, { connId: this.id });
    this.ws.send(message);
  }

  private closeWithCode(wsCode: number, code: ErrorCode, message: string) {
    this.logInfo(`closing with code ${wsCode}: ${message}`, {
      connId: this.id,
      wsCode,
      code,
    });
    this.sendEvent({
      type: 'error',
      code,
      message,
      fatal: true,
      reconnect: true,
    });
    this.ws.close(wsCode, message);
    this.onClosed();
  }

  private onClosed() {
    if (this.authenticated) {
      for (const clientId of this.clients) {
        this.broadcastEvent({
          type: 'client-leave',
          userId: this.authenticated.userId,
          clientId,
        });
      }
    }
    this.onClose();
  }
}
