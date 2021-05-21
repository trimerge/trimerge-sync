import WebSocket from 'ws';
import generate from 'project-name-generator';
import { ClientLeaveEvent, SyncEvent } from 'trimerge-sync';

export class Connection {
  private readonly id = generate({ words: 3 }).dashed;
  private readonly clients = new Set<string>();
  constructor(
    private readonly ws: WebSocket,
    private readonly userId: string,
    private readonly docId: string,
    private readonly connections: ReadonlySet<Connection>,
    private readonly onClose: () => void,
  ) {
    ws.on('close', () => {
      this.log('socket closed');
      this.onClosed();
    });
    ws.on('message', (message) => {
      if (typeof message !== 'string') {
        this.closeWithCode(1003, 'unsupported data');
        return;
      }
      if (message.length > 1_000_000) {
        this.closeWithCode(1009, 'payload too big');
        return;
      }
      this.log('--> received', message);
      this.onMessage(message);
    });
    this.log(`added docId: ${docId}, userId: ${userId}`);
  }

  private onMessage(message: string) {
    let data: SyncEvent<unknown, unknown, unknown>;
    try {
      data = JSON.parse(message);
    } catch (e) {
      this.closeWithCode(1003, 'invalid json');
      return;
    }
    switch (data.type) {
      case 'nodes':
        this.broadcast(message);
        break;

      case 'client-join':
      case 'client-presence': {
        const { userId, clientId } = data.info;
        if (userId !== this.userId) {
          this.closeWithCode(1003, 'userId does not match');
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
          this.closeWithCode(1003, 'userId does not match');
          return;
        }
        if (!this.clients.has(clientId)) {
          this.closeWithCode(1003, 'client-leave for unknown clientId');
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
        // this.closeWithCode(1003, 'unexpected event');
        return;
    }
  }

  private broadcast(message: string) {
    for (const connection of this.connections) {
      if (connection !== this) {
        connection.send(message);
      }
    }
  }
  private send(message: string) {
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
