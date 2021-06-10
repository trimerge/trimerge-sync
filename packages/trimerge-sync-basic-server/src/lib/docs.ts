import { Connection } from './connection';
import { parse } from 'querystring';
import { AckNodesEvent, NodesEvent } from 'trimerge-sync';
import { DocStore } from '../DocStore';

export function parseUrl(
  url: string | undefined,
): { docId: string; userId?: string; lastSyncId?: string } {
  if (!url) {
    throw new Error('no url');
  }
  const [, docId, query = ''] =
    /^\/+([^\/?]+)\/?.*?(?:\?(.+))?/.exec(url) ?? [];
  if (!docId) {
    throw new Error('invalid url');
  }
  const { lastSyncId, userId } = parse(query);
  if (userId !== undefined && typeof userId !== 'string') {
    throw new Error('invalid userId');
  }
  if (lastSyncId !== undefined && typeof lastSyncId !== 'string') {
    throw new Error('invalid lastSyncId');
  }
  return { docId, userId, lastSyncId };
}

export class LiveDoc {
  private readonly connections = new Set<Connection>();

  constructor(public readonly store: DocStore) {}

  add(conn: Connection): void {
    this.connections.add(conn);
  }

  remove(conn: Connection): void {
    this.connections.delete(conn);
  }

  isEmpty(): boolean {
    return this.connections.size === 0;
  }

  broadcast(from: Connection, message: string) {
    for (const conn of this.connections) {
      if (conn !== from) {
        conn.send(message);
      }
    }
  }

  close(): void {
    this.store.close();
  }

  async addNodes(
    event: NodesEvent<unknown, unknown, unknown>,
  ): Promise<AckNodesEvent> {
    return this.store.add(event.nodes);
  }
}
