import { Connection } from './connection';
import WebSocket from 'ws';
import { parse } from 'querystring';
import { DocStore } from './store';
import { AckNodesEvent, NodesEvent, SyncEvent } from 'trimerge-sync';
import { join } from 'path';
import { mkdirp, mkdirpSync } from 'fs-extra';

export const liveDocs = new Map<string, LiveDoc>();

function parseUrl(
  url: string | undefined,
): { docId: string; userId: string; lastSyncId?: string } {
  if (!url) {
    throw new Error('no url');
  }
  const [, docId, query = ''] =
    /^\/+([^\/?]+)\/?.*?(?:\?(.+))?/.exec(url) ?? [];
  if (!docId) {
    throw new Error('invalid url');
  }
  const { lastSyncId, userId } = parse(query);
  if (!userId) {
    throw new Error('missing userId');
  }
  if (typeof userId !== 'string') {
    throw new Error('invalid userId');
  }
  return {
    docId,
    userId,
    lastSyncId:
      lastSyncId && typeof lastSyncId === 'string' ? lastSyncId : undefined,
  };
}

const dataDir = join(__dirname, '..', '_data');
mkdirpSync(dataDir);

export class LiveDoc {
  private readonly connections = new Set<Connection>();
  public readonly store: DocStore;

  constructor(docId: string) {
    this.store = new DocStore(docId, dataDir);
  }

  add(conn: Connection) {
    this.connections.add(conn);
  }

  remove(conn: Connection) {
    this.connections.delete(conn);
    return this.connections.size === 0;
  }

  broadcast(from: Connection, message: string) {
    for (const conn of this.connections) {
      if (conn !== from) {
        conn.send(message);
      }
    }
  }

  close() {
    this.store.close();
  }

  async addNodes(
    event: NodesEvent<unknown, unknown, unknown>,
  ): Promise<AckNodesEvent> {
    return this.store.add(event.nodes);
  }
}

export function addSocket(
  ws: WebSocket,
  url: string | undefined,
  connectionId: string,
) {
  const { docId, userId, lastSyncId } = parseUrl(url);
  const liveDoc = liveDocs.get(docId) ?? new LiveDoc(docId);
  liveDocs.set(docId, liveDoc);
  const conn = new Connection(
    connectionId,
    ws,
    userId,
    docId,
    lastSyncId,
    liveDoc,
    () => {
      if (liveDoc.remove(conn)) {
        liveDoc.close();
        liveDocs.delete(docId);
      }
    },
  );
  liveDoc.add(conn);
}
