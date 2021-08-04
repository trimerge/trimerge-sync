import type { AckNodesEvent, DiffNode, NodesEvent } from 'trimerge-sync';
import type { NodeValidation } from './lib/validate';

export interface DocStore {
  getNodesEvent(
    lastSyncId?: string,
  ):
    | Promise<NodesEvent<unknown, unknown, unknown>>
    | NodesEvent<unknown, unknown, unknown>;

  add(
    nodes: readonly DiffNode<unknown, unknown>[],
    validation: NodeValidation,
  ): Promise<AckNodesEvent> | AckNodesEvent;

  close(): void;
}
