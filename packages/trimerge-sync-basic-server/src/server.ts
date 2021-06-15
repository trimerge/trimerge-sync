import { Server } from 'ws';
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

  attach(wss: Server) {
    let id = 0;

    wss.on('connection', (ws, req) => {
      const connId = (id++).toString(16);
      try {
        this.logInfo(`${connId}: new connection`);
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
        this.logInfo(`${connId}: closing connection: ${e}`);
        ws.close();
      }
    });
  }

  listen(port: number) {
    const wss = new Server({ port });
    this.attach(wss);

    wss.on('listening', () => {
      this.logInfo(`listening on: ${wss.address()}`);
    });
  }
}
