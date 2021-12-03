import { Connection } from './connection';
import type { AckCommitsEvent, CommitsEvent } from 'trimerge-sync';
import { validateCommitOrder, addInvalidRefsToAckEvent } from 'trimerge-sync';
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

  async addCommits(event: CommitsEvent<unknown, unknown, unknown>): Promise<{
    commits: CommitsEvent<unknown, unknown, unknown>;
    ack: AckCommitsEvent;
  }> {
    const { newCommits, invalidRefs } = validateCommitOrder(event.commits);
    const ack = addInvalidRefsToAckEvent(
      await this.store.add(newCommits),
      invalidRefs,
    );
    const acks = new Set(ack.refs.map((ref)=>ref.ref));
    return {
      commits: {
        type: 'commits',
        // Only broadcast the acknowledged commits
        commits: event.commits.filter(({ ref }) => acks.has(ref)),
        syncId: ack.syncId,
        clientInfo: event.clientInfo,
      },
      ack,
    };
  }
}
