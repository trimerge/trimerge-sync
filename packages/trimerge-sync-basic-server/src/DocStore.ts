import { AckNodesEvent, DiffNode, NodesEvent } from 'trimerge-sync';

export interface DocStore {
  getNodesEvent(
    lastSyncId?: string,
  ):
    | Promise<NodesEvent<unknown, unknown, unknown>>
    | NodesEvent<unknown, unknown, unknown>;

  add(
    nodes: readonly DiffNode<unknown, unknown>[],
  ): Promise<AckNodesEvent> | AckNodesEvent;

  delete(): Promise<void>;

  close(): void;
}
