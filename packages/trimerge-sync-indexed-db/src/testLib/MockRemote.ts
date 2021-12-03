import type {
  Commit,
  GetRemoteFn,
  OnEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from 'trimerge-sync';
import { addInvalidRefsToAckEvent, validateCommitOrder } from 'trimerge-sync';

class MockRemote implements Remote<any, any, any> {
  constructor(
    private readonly userId: string,
    private readonly remoteSyncInfo: RemoteSyncInfo,
    private readonly onEvent: OnEventFn<any, any, any>,
    private readonly commits?: Commit<any, any>[],
  ) {
    this.onEvent({ type: 'remote-state', connect: 'online' });
    this.onEvent({ type: 'ready' });
  }
  send(event: SyncEvent<any, any, any>): void {
    switch (event.type) {
      case 'commits':
        const { newCommits, invalidRefs } = validateCommitOrder<any, any>(
          event.commits,
        );
        this.commits?.push(...newCommits);
        this.onEvent(
          addInvalidRefsToAckEvent(
            {
              type: 'ack',
              refs: newCommits.map(({ ref }) => ({ref})),
              syncId: 'foo',
            },
            invalidRefs,
          ),
        );
    }
  }

  shutdown(): void {
    this.onEvent({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }
}
export const getMockRemote = getMockRemoteForCommits();

export function getMockRemoteForCommits(
  commits?: Commit<any, any>[],
): GetRemoteFn<any, any, any> {
  return (userId, remoteSyncInfo, onEvent) =>
    new MockRemote(userId, remoteSyncInfo, onEvent, commits);
}
