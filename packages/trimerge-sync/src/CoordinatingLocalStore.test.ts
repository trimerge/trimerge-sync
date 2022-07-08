import { CoordinatingLocalStore } from './CoordinatingLocalStore';
import { timeout } from './lib/Timeout';
import {
  AckCommitsEvent,
  CommitRepository,
  CommitsEvent,
  OnRemoteEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from './types';

class MockCommitRepository
  implements CommitRepository<unknown, unknown, unknown>
{
  async acknowledgeRemoteCommits(): Promise<void> {
    //
  }

  async addCommits(): Promise<AckCommitsEvent> {
    return { type: 'ack', acks: [], syncId: '' };
  }

  async getRemoteSyncInfo(): Promise<RemoteSyncInfo> {
    return { localStoreId: '', lastSyncCursor: undefined };
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
}

describe('CoordinatingLocalStore', () => {
  it('handle double shutdown', async () => {
    const fn = jest.fn();
    const store = new CoordinatingLocalStore(
      '',
      '',
      fn,
      new MockCommitRepository(),
    );
    await store.shutdown();
    await store.shutdown();
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "connect": "offline",
            "read": "offline",
            "save": "ready",
            "type": "remote-state",
          },
          false,
        ],
        Array [
          Object {
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
      localStore = new CoordinatingLocalStore(
        '',
        '',
        fn,
        new MockCommitRepository(),
        (_, __, onEvent) => {
          mockRemote = new MockRemote(onEvent);
          sendSpy = jest.spyOn(mockRemote, 'send');
          resolve();
          return mockRemote;
        },
      );
    });

    mockRemote!.onEvent({ type: 'remote-state', connect: 'online' });
    mockRemote!.onEvent({ type: 'remote-state', connect: 'online' });

    await timeout();

    expect(sendSpy!.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "type": "ready",
          },
        ],
        Array [
          Object {
            "info": Object {
              "clientId": "",
              "presence": undefined,
              "ref": undefined,
              "userId": "",
            },
            "type": "client-join",
          },
        ],
      ]
    `);

    await localStore!.shutdown();
  });

  it('handle empty update call', async () => {
    const fn = jest.fn();
    const store = new CoordinatingLocalStore(
      '',
      '',
      fn,
      new MockCommitRepository(),
    );
    await store.update([], undefined);
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
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
