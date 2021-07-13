import type WebSocket from 'ws';
import type { ErrorCode, SyncEvent } from 'trimerge-sync';
import { PromiseQueue } from 'trimerge-sync';
import type { LiveDoc } from './docs';
import type { Authenticated, AuthenticateFn, Logger } from '../types';
import { InternalError, MessageTooBig, UnsupportedData } from './codes';

export class Connection {
  private readonly clients = new Set<string>();
  private readonly queue = new PromiseQueue();
  private clientStoreId?: string = undefined;
  private authenticated?: Authenticated = undefined;

  constructor(
    private readonly ws: WebSocket,
    private readonly docId: string,
    private readonly liveDoc: LiveDoc,
    private readonly authenticate: AuthenticateFn,
    private readonly onClose: () => void,
    public readonly logger: Logger,
  ) {
    ws.on('close', () => {
      this.logger.info('socket closed', {});
      this.queueExec(async () => this.onClosed());
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
      this.logger.debug(`--> received ${message}`, {});
      this.queueExec(() => this.onMessage(message));
    });
    ws.on('error', onClose);
  }

  private queueExec(fn: () => Promise<void>): void {
    this.queue
      .add(fn)
      .catch((error: Error) =>
        this.closeWithCode(
          InternalError,
          'internal',
          `internal error: ${error}`,
        ),
      );
  }

  private async sendInitialEvents(
    lastSyncId: string | undefined,
  ): Promise<void> {
    // Call store multiple times so that it can do paging if desired
    while (true) {
      const event = await this.liveDoc.store.getNodesEvent(lastSyncId);
      if (event.nodes.length === 0) {
        break;
      }
      this.sendEvent(event);
      lastSyncId = event.syncId;
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
      if (data.version !== 1) {
        this.sendEvent({
          type: 'error',
          code: 'bad-request',
          message: 'unsupported client version',
          fatal: false,
        });
        return;
      }
      if (this.authenticated) {
        this.sendEvent({
          type: 'error',
          code: 'bad-request',
          message: 'already authenticated',
          fatal: false,
        });
        return;
      }
      const { auth, localStoreId, lastSyncCursor } = data;
      this.authenticated = await this.authenticate(this.docId, auth);
      this.clientStoreId = localStoreId;
      this.logger.info(`initialize`, {
        userId: this.authenticated.userId,
        localStoreId,
        lastSyncCursor,
      });
      await this.sendInitialEvents(lastSyncCursor);
      return;
    }

    if (!this.authenticated) {
      this.closeWithCode(UnsupportedData, 'unauthorized', 'unauthorized');
      return;
    }

    switch (data.type) {
      case 'nodes': {
        const { ack, nodes } = await this.liveDoc.addNodes(data);
        this.sendEvent(ack);
        this.broadcastEvent(nodes);
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
          this.logger.debug('adding clientId', { clientId });
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
        this.logger.debug(`removing clientId`, { clientId });
        this.clients.delete(clientId);
        break;
      }

      case 'ready':
        // Do nothing
        break;

      case 'remote-state':
      case 'ack':
      case 'error':
      default: {
        this.logger.warn(`invalid command ${data.type}`);
        this.closeWithCode(UnsupportedData, 'bad-request', 'unexpected event');
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

  public receiveBroadcast(from: Connection, message: string) {
    if (from === this) {
      return;
    }
    this.queueExec(async () => {
      const { clientStoreId, authenticated } = this;
      if (!authenticated) {
        return;
      }
      // Don't send to other clients with the same userId/clientStoreId pair
      if (
        authenticated.userId === from.authenticated?.userId &&
        clientStoreId === from.clientStoreId
      ) {
        return;
      }
      this.send(message);
    });
  }

  private send(message: string) {
    this.logger.debug(`<-- sending: ${message}`);
    this.ws.send(message);
  }

  private closeWithCode(wsCode: number, code: ErrorCode, message: string) {
    this.logger.info(`closing with code ${wsCode}: ${message}`, {
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

  private onClosed(): void {
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
