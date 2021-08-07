import type {
  DiffNode,
  GetRemoteFn,
  OnEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from 'trimerge-sync';
import {
  addInvalidNodesToAckEvent,
  validateDiffNodeOrder,
} from 'trimerge-sync';

class MockRemote implements Remote<any, any, any> {
  constructor(
    private readonly userId: string,
    private readonly remoteSyncInfo: RemoteSyncInfo,
    private readonly onEvent: OnEventFn<any, any, any>,
    private readonly nodes?: DiffNode<any, any>[],
  ) {
    this.onEvent({ type: 'remote-state', connect: 'online' });
    this.onEvent({ type: 'ready' });
  }
  send(event: SyncEvent<any, any, any>): void {
    switch (event.type) {
      case 'nodes':
        const { newNodes, invalidNodeRefs } = validateDiffNodeOrder<any, any>(
          event.nodes,
        );
        this.nodes?.push(...newNodes);
        this.onEvent(
          addInvalidNodesToAckEvent(
            {
              type: 'ack',
              refs: newNodes.map(({ ref }) => ref),
              syncId: 'foo',
            },
            invalidNodeRefs,
          ),
        );
    }
  }

  shutdown(): void {
    this.onEvent({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }
}
export const getMockRemote = getMockRemoteForNodes();

export function getMockRemoteForNodes(
  nodes?: DiffNode<any, any>[],
): GetRemoteFn<any, any, any> {
  return (userId, remoteSyncInfo, onEvent) =>
    new MockRemote(userId, remoteSyncInfo, onEvent, nodes);
}
