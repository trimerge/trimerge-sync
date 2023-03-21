import { CoordinatingLocalStore } from './CoordinatingLocalStore';
import { timeout } from './lib/Timeout';
import { MemoryEventChannel } from './testLib/MemoryBroadcastChannel';
import {
  AckCommitsEvent,
  CommitRepository,
  CommitsEvent,
  Logger,
  OnRemoteEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from './types';

class MockCommitRepository
  implements CommitRepository<unknown, unknown, unknown>
{
  configureLogger(logger: Logger): void {
    /* no-op */
  }
  async acknowledgeRemoteCommits(): Promise<void> {
    //
  }

  async addCommits(): Promise<AckCommitsEvent> {
    return { type: 'ack', acks: [], syncId: '' };
  }

  async getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return { lastSyncCursor: undefined, firstSyncCursor: undefined };
  }

  async *getLocalCommits(): AsyncIterableIterator<
    CommitsEvent<unknown, unknown, unknown>
  > {
    //
  }

  async *getCommitsForRemote(): AsyncIterableIterator<
    CommitsEvent<unknown, unknown, unknown>
  > {
    //
  }

  shutdown() {
    //
  }
}

class MockRemote implements Remote<unknown, unknown, unknown> {
  constructor(readonly onEvent: OnRemoteEventFn<unknown, unknown, unknown>) {}

  send(event: SyncEvent<unknown, unknown, unknown>): void {
    //
  }

  shutdown(): void | Promise<void> {
    //
  }

  configureLogger() {
    /* no-op */
  }
}

describe('CoordinatingLocalStore', () => {
  it('handle double shutdown', async () => {
    const fn = jest.fn();
    const store = new CoordinatingLocalStore('', '', '', {
      onStoreEvent: fn,
      commitRepo: new MockCommitRepository(),
      localChannel: new MemoryEventChannel('dummy'),
    });
    await store.shutdown();
    await store.shutdown();
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "connect": "offline",
            "read": "offline",
            "save": "ready",
            "type": "remote-state",
          },
          false,
        ],
        [
          {
            "type": "ready",
          },
          false,
        ],
      ]
    `);
  });
  it('does not send two client join events if the current state is online', async () => {
    const fn = jest.fn();
    let mockRemote: MockRemote;
    let sendSpy: jest.SpyInstance;
    let localStore: CoordinatingLocalStore<unknown, unknown, unknown>;

    await new Promise<void>((resolve) => {
      localStore = new CoordinatingLocalStore('', '', '', {
        onStoreEvent: fn,
        commitRepo: new MockCommitRepository(),
        getRemote: (_, __, ___, onEvent) => {
          mockRemote = new MockRemote(onEvent);
          sendSpy = jest.spyOn(mockRemote, 'send');
          resolve();
          return mockRemote;
        },
        localChannel: new MemoryEventChannel('dummy'),
      });
    });

    mockRemote!.onEvent({ type: 'remote-state', connect: 'online' });
    mockRemote!.onEvent({ type: 'remote-state', connect: 'online' });

    await timeout();

    expect(sendSpy!.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "type": "ready",
          },
        ],
        [
          {
            "info": {
              "clientId": "",
              "presence": undefined,
              "ref": undefined,
              "userId": "",
            },
            "type": "client-join",
          },
        ],
        [
          {
            "info": {
              "clientId": "",
              "presence": undefined,
              "ref": undefined,
              "userId": "",
            },
            "type": "client-presence",
          },
        ],
      ]
    `);

    await localStore!.shutdown();
  });

  it('handle empty update call', async () => {
    const fn = jest.fn();
    const store = new CoordinatingLocalStore('', '', '', {
      onStoreEvent: fn,
      commitRepo: new MockCommitRepository(),
      localChannel: new MemoryEventChannel('dummy'),
    });
    await store.update([], undefined);
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "connect": "offline",
            "read": "offline",
            "save": "ready",
            "type": "remote-state",
          },
          false,
        ],
      ]
    `);
  });
});
