import type { ServerOptions } from 'ws';
import type { IncomingMessage } from 'http';
import WebSocket, { Server } from 'ws';
import type { DocStore } from './DocStore';
import type { AuthenticateFn, Logger } from './types';
import { LiveDoc } from './lib/docs';
import { WebSocketConnection } from './lib/connection';

function getMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
          ws.on('error', (e) => {
            logger.warn(`connection error`, {
              docId,
              message: String(e),
              remoteAddress: req.socket.remoteAddress,
              remotePort: req.socket.remotePort,
              remoteFamily: req.socket.remoteFamily,
            });
            ws.close();
          });
          const liveDoc =
            this.liveDocs.get(docId) ?? new LiveDoc(this.makeDocStore(docId));
          this.liveDocs.set(docId, liveDoc);
          const conn = new WebSocketConnection(
            ws,
            docId,
            liveDoc,
            this.authenticate,
            () => {
              conn.logger.debug(`removing connection`);
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
            error: getMessage(e),
          });
          ws.close();
        }
      } catch (e) {
        const message = getMessage(e);
        this.serverLogger.warn(`invalid request ${message}`, {
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
          remoteFamily: req.socket.remoteFamily,
          error: message,
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
