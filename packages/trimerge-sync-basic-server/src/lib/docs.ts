import { Connection } from './connection';
import type { AckNodesEvent, NodesEvent } from 'trimerge-sync';
import {
  addInvalidNodesToAckEvent,
  validateDiffNodeOrder,
} from 'trimerge-sync';
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
      conn.receiveBroadcast(from, message);
    }
  }

  close(): void {
    this.store.close();
  }

  async addNodes(event: NodesEvent<unknown, unknown, unknown>): Promise<{
    nodes: NodesEvent<unknown, unknown, unknown>;
    ack: AckNodesEvent;
  }> {
    const { newNodes, invalidNodeRefs } = validateDiffNodeOrder(event.nodes);
    const ack = addInvalidNodesToAckEvent(
      await this.store.add(newNodes),
      invalidNodeRefs,
    );
    const acks = new Set(ack.refs);
    return {
      nodes: {
        type: 'nodes',
        // Only broadcast the acknowledged nodes
        nodes: event.nodes.filter(({ ref }) => acks.has(ref)),
        syncId: ack.syncId,
        clientInfo: event.clientInfo,
      },
      ack,
    };
  }
}
