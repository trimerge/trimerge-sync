import { CoordinatingLocalStore } from './CoordinatingLocalStore';
import { timeout } from './lib/Timeout';
import { MemoryEventChannel } from './testLib/MemoryBroadcastChannel';
import { MockRemote } from './testLib/MockRemote';
import {
  AckCommitsEvent,
  CommitRepository,
  CommitsEvent,
  Logger,
  RemoteSyncInfo,
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

describe('CoordinatingLocalStore', () => {
  it('handle double shutdown', async () => {
    const fn = jest.fn();
    const store = new CoordinatingLocalStore('', '', {
      commitRepo: new MockCommitRepository(),
      localChannel: new MemoryEventChannel('dummy'),
    });

    store.listen(fn);
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
  it('correctly buffers events emitted before listening', async () => {
    const store = new CoordinatingLocalStore('', '', {
      commitRepo: new MockCommitRepository(),
      localChannel: new MemoryEventChannel('dummy'),
    });
    await timeout();
    const fn = jest.fn();
    store.listen(fn);
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
          false,
        ],
      ]
    `);
  });
  it('does not send two client join events if the current state is online', async () => {
    const remote = new MockRemote();
    const sendSpy: jest.SpyInstance = jest.spyOn(remote, 'send');

    const localStore = new CoordinatingLocalStore('', '', {
      commitRepo: new MockCommitRepository(),
      remote,
      localChannel: new MemoryEventChannel('repeated-online-events'),
    });

    // Wait for coordinating local store to listen to the remote.
    await remote.connected;

    remote.emit({ type: 'remote-state', connect: 'online' });
    remote.emit({ type: 'remote-state', connect: 'online' });

    await timeout();

    expect(sendSpy.mock.calls).toMatchInlineSnapshot(`
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
      ]
    `);

    await localStore.shutdown();
  });

  it('handle empty update call', async () => {
    const fn = jest.fn();
    const store = new CoordinatingLocalStore('', '', {
      commitRepo: new MockCommitRepository(),
      localChannel: new MemoryEventChannel('dummy'),
    });
    store.listen(fn);

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
