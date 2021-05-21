import { Connection } from './connection';
import WebSocket from 'ws';
import { parse } from 'querystring';

export const docConnections = new Map<string, Set<Connection>>();

function parseUrl(url: string | undefined): { docId: string; userId: string } {
  if (!url) {
    throw new Error('no url');
  }
  const [, docId, query = ''] =
    /^\/+([^\/?]+)\/?.*?(?:\?(.+))?/.exec(url) ?? [];
  if (!docId) {
    throw new Error('invalid url');
  }
  const params = parse(query);
  if (!params.userId) {
    throw new Error('missing userId');
  }
  if (typeof params.userId !== 'string') {
    throw new Error('invalid userId');
  }
  return { docId, userId: params.userId };
}

export function addSocket(ws: WebSocket, url: string | undefined) {
  const { docId, userId } = parseUrl(url);
  const connections = docConnections.get(docId) ?? new Set();
  docConnections.set(docId, connections);
  const conn = new Connection(ws, userId, docId, connections, () => {
    connections.delete(conn);
    if (connections.size === 0) {
      docConnections.delete(docId);
    }
  });
  connections.add(conn);
}
