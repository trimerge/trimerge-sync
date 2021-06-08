import WebSocket from 'ws';
import generate from 'project-name-generator';
import type { ClientLeaveEvent, SyncEvent } from 'trimerge-sync';
import { PromiseQueue } from 'trimerge-sync';
import { InternalError, MessageTooBig, UnsupportedData } from './codes';
import { LiveDoc } from './docs';

export class Connection {
  private readonly clients = new Set<string>();
  private readonly queue = new PromiseQueue();

  constructor(
    private readonly id: string,
    private readonly ws: WebSocket,
    private readonly userId: string,
    private readonly docId: string,
    private readonly lastSyncId: string | undefined,
    private readonly liveDoc: LiveDoc,
    private readonly onClose: () => void,
  ) {
    ws.on('close', () => {
      this.log('socket closed');
      this.queue
        .add(async () => this.onClosed())
        .catch((error) => {
          this.closeWithCode(InternalError, `internal error: ${error}`);
        });
    });
    ws.on('message', (message) => {
      if (typeof message !== 'string') {
        this.closeWithCode(UnsupportedData, 'unsupported data');
        return;
      }
      if (message.length > 1_000_000) {
        this.closeWithCode(MessageTooBig, 'payload too big');
        return;
      }
      this.log('--> received', message);
      this.queue.add(() => this.onMessage(message));
    });
    this.queue.add(() => this.sendInitialEvents(lastSyncId));
    this.log(`docId="${docId}" userId="${userId}" lastSyncId="${lastSyncId}"`);
  }

  private async sendInitialEvents(
    lastSyncId: string | undefined,
  ): Promise<void> {
    const event = this.liveDoc.store.getNodesEvent(lastSyncId);
    if (event.nodes.length > 0) {
      this.send(JSON.stringify(event));
    }
    this.send(JSON.stringify({ type: 'ready' }));
  }

  private async onMessage(message: string): Promise<void> {
    let data: SyncEvent<unknown, unknown, unknown>;
    try {
      data = JSON.parse(message);
    } catch (e) {
      this.closeWithCode(UnsupportedData, 'invalid json');
      return;
    }
    switch (data.type) {
      case 'nodes':
        const response = await this.liveDoc.addNodes(data);
        this.send(JSON.stringify(response));
        this.broadcast(JSON.stringify({ ...data, syncId: response.syncId }));
        break;

      case 'client-join':
      case 'client-presence': {
        const { userId, clientId } = data.info;
        if (userId !== this.userId) {
          this.closeWithCode(UnsupportedData, 'userId does not match');
          return;
        }
        this.broadcast(message);
        if (!this.clients.has(clientId)) {
          this.log('adding clientId: ' + clientId);
          this.clients.add(clientId);
        }
        break;
      }

      case 'client-leave':
        const { userId, clientId } = data;
        if (userId !== this.userId) {
          this.closeWithCode(UnsupportedData, 'userId does not match');
          return;
        }
        if (!this.clients.has(clientId)) {
          this.closeWithCode(
            UnsupportedData,
            'client-leave for unknown clientId',
          );
          return;
        }
        this.broadcast(message);
        this.log(`removing clientId: ${clientId}`);
        this.clients.delete(clientId);
        break;

      case 'ready':
      case 'remote-state':
      case 'ack':
      case 'error':
        this.log('ignoring command');
        // this.closeWithCode(UnsupportedData, 'unexpected event');
        return;
    }
  }

  private broadcast(message: string) {
    this.liveDoc.broadcast(this, message);
  }
  public send(message: string) {
    this.log('<-- sending', message);
    this.ws.send(message);
  }

  private closeWithCode(code: number, reason: string) {
    this.log(`closing with code ${code}: ${reason}`);
    this.ws.close(code, reason);
    this.onClosed();
  }

  private onClosed() {
    for (const clientId of this.clients) {
      const event: ClientLeaveEvent = {
        type: 'client-leave',
        userId: this.userId,
        clientId,
      };
      this.broadcast(JSON.stringify(event));
    }
    this.onClose();
  }

  private log(...args: any[]) {
    console.log(`[${this.id}]`, ...args);
  }
}
