import { Connection } from './connection';
import { AckNodesEvent, NodesEvent } from 'trimerge-sync';
import { DocStore } from '../DocStore';

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
