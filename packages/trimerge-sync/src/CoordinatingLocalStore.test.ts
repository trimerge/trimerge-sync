import { CoordinatingLocalStore } from './CoordinatingLocalStore';
import { timeout } from './lib/Timeout';
import { MemoryEventChannel } from './testLib/MemoryBroadcastChannel';
import { MemoryCommitRepository } from './testLib/MemoryCommitRepository';
import { MemoryStore } from './testLib/MemoryStore';
import { MockRemote } from './testLib/MockRemote';
import {
  AckCommitsEvent,
  Commit,
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
      localChannel: new MemoryEventChannel('double-shutdown'),
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
    await remote.onConnected();

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
      localChannel: new MemoryEventChannel('empty-update'),
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

  it("doesn't send commits to the remote until it's been initialized", async () => {
    // this test is a bit complicated because it relies on the precise
    // ordering of a couple of async operations. Specifically,
    // the bug only occurs in the case that we have started connecting to a remote
    // but we haven't sent it the existing commits and there is a pending save
    // operation.

    // What could happen previously is:
    //  - we start connecting to the remote
    //  - we start getting the local commits that we have to send to the remote
    //  - we start saving a new commit
    //  - we finish saving the new commit
    //  - we send a message about the newly saved local commit, before the we've completed getting the local commits to send to the remote
    //  - the remote gets the commits out of order

    // Now we wait make sure to send the remote all of the commits we have in the local store while buffering any new commits that come.
    // Those buffered commits are sent after we've sent all of the commits we have in the local store to the remote.

    // remotePromise is used so that we can get the remote once the store has created it.
    const remote = new MockRemote();

    // We use getCommitsPromise to block the completion of the getCommitsForRemote call until the
    // addCommits call has been completed.
    let getCommitsResolve: () => void;
    const getCommitsPromise = new Promise<void>((resolve) => {
      getCommitsResolve = resolve;
    });

    const commitRepo = new MemoryCommitRepository(new MemoryStore());
    const existingCommits: Commit<unknown, unknown>[] = [
      { ref: '1', delta: '', metadata: {} },
    ];
    await commitRepo.addCommits(existingCommits);

    const realGetCommitsForRemote =
      commitRepo.getCommitsForRemote.bind(commitRepo);
    jest
      .spyOn(commitRepo, 'getCommitsForRemote')
      .mockImplementation(async function* () {
        await getCommitsPromise;
        yield* realGetCommitsForRemote();
      });

    const store = new CoordinatingLocalStore('', '', {
      commitRepo,
      localChannel: new MemoryEventChannel('remote-initialization'),
      remote,
      networkSettings: {
        electionTimeoutMs: 100,
        initialDelayMs: 100,
      },
    });

    const sendSpy = jest.spyOn(remote, 'send');

    await store.update(
      [{ baseRef: '1', ref: '2', delta: '', metadata: {} }],
      undefined,
    );

    getCommitsResolve!();

    await timeout();

    expect(sendSpy.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "commits": [
              {
                "delta": "",
                "metadata": {},
                "ref": "1",
              },
              {
                "baseRef": "1",
                "delta": "",
                "metadata": {},
                "ref": "2",
              },
            ],
            "type": "commits",
          },
        ],
        [
          {
            "clientInfo": undefined,
            "commits": [
              {
                "baseRef": "1",
                "delta": "",
                "metadata": {},
                "ref": "2",
              },
            ],
            "syncId": "2",
            "type": "commits",
          },
        ],
        [
          {
            "type": "ready",
          },
        ],
      ]
    `);
  });
});
