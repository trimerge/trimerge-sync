import type {
  Commit,
  GetRemoteFn,
  OnRemoteEventFn,
  Remote,
  SyncEvent,
} from 'trimerge-sync';
import { addInvalidRefsToAckEvent, validateCommitOrder } from 'trimerge-sync';

class MockRemote implements Remote<any, any, any> {
  constructor(
    private readonly onEvent: OnRemoteEventFn<any, any, any>,
    private readonly commits: Map<string, Commit<any, any>> = new Map(),
    private readonly getRemoteMetadata?: (commit: Commit<any, any>) => any,
  ) {
    this.onEvent({ type: 'remote-state', connect: 'online' });
    this.onEvent({ type: 'ready' });
  }
  send(event: SyncEvent<any, any, any>): void {
    // broadcast to other clients
    switch (event.type) {
      case 'commits':
        const { newCommits, invalidRefs } = validateCommitOrder<any, any>(
          event.commits,
        );
        for (const commit of newCommits) {
          if (!this.commits.has(commit.ref)) {
            this.commits.set(commit.ref, commit);
          }
        }
        this.onEvent(
          addInvalidRefsToAckEvent(
            {
              type: 'ack',
              acks: newCommits.map(({ ref }) => {
                return {
                  ref,
                  metadata: this.getRemoteMetadata?.(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this.commits.get(ref)!,
                  ),
                };
              }),
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
export const getMockRemote = getMockRemoteWithMap();

export function getMockRemoteWithMap(
  commits?: Map<string, Commit<any, any>>,
  getRemoteMetadata?: (commit: Commit<any, any>) => any,
): GetRemoteFn<any, any, any> {
  return (userId, remoteSyncInfo, onEvent) =>
    new MockRemote(userId, remoteSyncInfo, onEvent, commits, getRemoteMetadata);
}
