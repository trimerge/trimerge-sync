import type { ServerOptions } from 'ws';
import type { IncomingMessage } from 'http';
import WebSocket, { Server } from 'ws';
import type { DocStore } from './DocStore';
import type { AuthenticateFn, LogFn } from './types';
import { LiveDoc, parseUrl } from './lib/docs';
import { Connection } from './lib/connection';

const DEFAULT_LOG_INFO: LogFn = (message, params) =>
  console.log(message, params);

const DEFAULT_LOG_WARN: LogFn = (message, params) =>
  console.warn(message, params);

export class BasicServer {
  private readonly liveDocs = new Map<string, LiveDoc>();

  constructor(
    private readonly authenticate: AuthenticateFn,
    private readonly makeDocStore: (docId: string) => DocStore,
    private readonly logDebug: LogFn = DEFAULT_LOG_INFO,
    private readonly logInfo: LogFn = DEFAULT_LOG_INFO,
    private readonly logWarn: LogFn = DEFAULT_LOG_WARN,
  ) {}

  attach(options: ServerOptions): () => void {
    const wss = new Server(options);
    let id = 0;

    const onConnection = (ws: WebSocket, req: IncomingMessage) => {
      const connId = (id++).toString(16);
      try {
        this.logInfo(`${connId}: new connection`, {
          connId,
          remoteAddress: req.socket.remoteAddress,
          remotePort: req.socket.remotePort,
          remoteFamily: req.socket.remoteFamily,
        });
        const { docId } = parseUrl(req.url);
        const liveDoc =
          this.liveDocs.get(docId) ?? new LiveDoc(this.makeDocStore(docId));
        this.liveDocs.set(docId, liveDoc);
        const conn = new Connection(
          connId,
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
          this.logDebug,
          this.logInfo,
          this.logWarn,
        );
        liveDoc.add(conn);
      } catch (e) {
        this.logInfo(`${connId}: closing connection: ${e}`, {
          connId,
          error: e.message,
        });
        ws.close();
      }
    };
    wss.on('connection', onConnection);
    wss.on('listening', () => {
      this.logInfo(`listening`, { ...(wss.address() as Record<string, any>) });
    });

    return () => {
      wss.off('connection', onConnection);
    };
  }
}
