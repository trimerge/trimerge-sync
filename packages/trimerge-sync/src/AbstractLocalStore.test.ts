import { AbstractLocalStore } from './AbstractLocalStore';
import { timeout } from './lib/Timeout';
import {
  AckCommitsEvent,
  CommitsEvent,
  GetRemoteFn,
  OnStoreEventFn,
  Remote,
  RemoteSyncInfo,
  SyncEvent,
} from './types';

class MockLocalStore extends AbstractLocalStore<unknown, unknown, unknown> {
  constructor(
    onEvent: OnStoreEventFn<unknown, unknown, unknown> = () => undefined,
    getRemote?: GetRemoteFn<unknown, unknown, unknown>,
  ) {
    super('', '', onEvent, getRemote);
    if (getRemote) {
      this.initialize().catch(this.handleAsError('internal'));
    }
  }
  async acknowledgeRemoteCommits(): Promise<void> {
    //
  }

  async addCommits(): Promise<AckCommitsEvent> {
    return { type: 'ack', acks: [], syncId: '' };
  }

  async broadcastLocal(): Promise<void> {
    //
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
}

class MockRemote implements Remote<unknown, unknown, unknown> {
  constructor(readonly onEvent: OnStoreEventFn<unknown, unknown, unknown>) {}

  send(event: SyncEvent<unknown, unknown, unknown>): void {
    //
  }

  shutdown(): void | Promise<void> {
    //
  }
}

describe('AbstractLocalStore', () => {
  it('fail if initialize is called twice', async () => {
    class DoubleInitTestStore extends MockLocalStore {
      constructor() {
        super();
        void this.initialize();
        void this.initialize();
      }
    }

    expect(() => new DoubleInitTestStore()).toThrowErrorMatchingInlineSnapshot(
      `"only call initialize() once"`,
    );
  });
  it('handle double shutdown', async () => {
    const fn = jest.fn();
    const store = new MockLocalStore(fn);
    await store.shutdown();
    await store.shutdown();
    expect(fn.mock.calls).toMatchInlineSnapshot(`Array []`);
  });
  it('does not send two client join events if the current state is online', async () => {
    const fn = jest.fn();
    let mockRemote: MockRemote;
    let sendSpy: jest.SpyInstance;
    let localStore: MockLocalStore;

    await new Promise<void>((resolve) => {
      localStore = new MockLocalStore(fn, (_, __, onEvent) => {
        mockRemote = new MockRemote(onEvent);
        sendSpy = jest.spyOn(mockRemote, 'send');
        resolve();
        return mockRemote;
      });
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
    const store = new MockLocalStore(fn);
    await store.update([], undefined);
    expect(fn.mock.calls).toMatchInlineSnapshot(`Array []`);
  });
});
