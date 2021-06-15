import type { ServerOptions } from 'ws';
import type { IncomingMessage } from 'http';
import WebSocket, { Server } from 'ws';
import type { DocStore } from './DocStore';
import type { AuthenticateFn, Logger } from './types';
import { LiveDoc } from './lib/docs';
import { Connection } from './lib/connection';

export class BasicServer {
  private readonly liveDocs = new Map<string, LiveDoc>();

  constructor(
    private readonly parseDocId: (url: string) => string,
    private readonly authenticate: AuthenticateFn,
    private readonly makeDocStore: (docId: string) => DocStore,
    private readonly serverLogger: Logger,
    private readonly getLogger: (docId: string) => Logger,
  ) {}

  /**
   * @returns detach function
   */
  attach(options: ServerOptions): () => void {
    const wss = new Server(options);
    const onConnection = (ws: WebSocket, req: IncomingMessage) => {
      try {
        if (!req.url) {
          // Not sure how this can happen
          throw new Error('no request url');
        }
        const docId = this.parseDocId(req.url);
        const logger = this.getLogger(docId);
        try {
          logger.info(`new connection`, {
            docId,
            remoteAddress: req.socket.remoteAddress,
            remotePort: req.socket.remotePort,
            remoteFamily: req.socket.remoteFamily,
          });
          const liveDoc =
            this.liveDocs.get(docId) ?? new LiveDoc(this.makeDocStore(docId));
          this.liveDocs.set(docId, liveDoc);
          const conn = new Connection(
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
            logger,
          );
          liveDoc.add(conn);
        } catch (e) {
          logger.warn(`error starting connection: ${e}`, {
            error: e.message,
          });
          ws.close();
        }
      } catch (e) {
        this.serverLogger.warn(`invalid request ${e.message}`, {
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
          remoteFamily: req.socket.remoteFamily,
          error: e.message,
        });
        ws.close();
      }
    };
    wss.on('connection', onConnection);
    wss.on('listening', () => {
      this.serverLogger.info(`listening`, {
        ...(wss.address() as Record<string, any>),
      });
    });

    return () => {
      wss.off('connection', onConnection);
      wss.close();
    };
  }
}
