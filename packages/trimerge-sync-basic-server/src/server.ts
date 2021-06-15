import express from 'express';
import { createServer } from 'http';
import type WebSocket from 'ws';
import { Server } from 'ws';
import type { DocStore } from './DocStore';
import { Connection } from './lib/connection';
import { LiveDoc, parseUrl } from './lib/docs';
import type { AuthenticateFn } from './types';

export class BasicServer {
  private readonly liveDocs = new Map<string, LiveDoc>();

  constructor(
    private readonly authenticate: AuthenticateFn,
    private readonly makeDocStore: (docId: string) => DocStore,
  ) {}

  private addSocket(
    ws: WebSocket,
    url: string | undefined,
    connectionId: string,
  ): void {
    const { docId } = parseUrl(url);
    const liveDoc =
      this.liveDocs.get(docId) ?? new LiveDoc(this.makeDocStore(docId));
    this.liveDocs.set(docId, liveDoc);
    const conn = new Connection(
      connectionId,
      ws,
      docId,
      liveDoc,
      this.authenticate,
      () => {
        liveDoc.remove(conn);
        if (liveDoc.isEmpty()) {
          liveDoc.close();
          this.liveDocs.delete(docId);
        }
      },
    );
    liveDoc.add(conn);
  }

  listen(port: number) {
    const app = express();
    app.get('/health', (req, res) => {
      res.status(200).send('ok');
    });
    const server = createServer(app);
    const wss = new Server({ server });

    let id = 0;

    wss.on('connection', (ws, req) => {
      const connId = (id++).toString(16);
      try {
        console.log(`${connId}: new connection`);
        this.addSocket(ws, req.url, connId);
      } catch (e) {
        console.log(`${connId}: closing connection: ${e}`);
        ws.close();
      }
    });
    server.listen(port, () => {
      console.log('listening on: %s', server.address());
    });
  }
}
