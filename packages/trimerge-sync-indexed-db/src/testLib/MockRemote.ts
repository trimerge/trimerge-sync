import type { GetRemoteFn, Remote, SyncEvent } from 'trimerge-sync';
import { OnEventFn, RemoteSyncInfo } from 'trimerge-sync/src/types';

class MockRemote implements Remote<any, any, any> {
  constructor(
    private readonly userId: string,
    private readonly remoteSyncInfo: RemoteSyncInfo,
    private readonly onEvent: OnEventFn<any, any, any>,
  ) {
    this.onEvent({ type: 'remote-state', connect: 'online' });
    this.onEvent({ type: 'ready' });
  }
  send(event: SyncEvent<any, any, any>): void {
    switch (event.type) {
      case 'nodes':
        this.onEvent({
          type: 'ack',
          refs: event.nodes.map(({ ref }) => ref),
          syncId: 'foo',
        });
    }
  }

  shutdown(): void {
    this.onEvent({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }
}
export const getMockRemote: GetRemoteFn<any, any, any> = (
  userId,
  remoteSyncInfo,
  onEvent,
) => new MockRemote(userId, remoteSyncInfo, onEvent);
