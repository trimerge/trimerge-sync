import { AbstractLocalStore } from './AbstractLocalStore';
import {
  AckCommitsEvent,
  CommitsEvent,
  OnEventFn,
  RemoteSyncInfo,
} from './types';

class MockLocalStore extends AbstractLocalStore<unknown, unknown, unknown> {
  constructor(onEvent: OnEventFn<unknown, unknown, unknown> = () => undefined) {
    super('', '', onEvent);
  }
  async acknowledgeRemoteCommits(): Promise<void> {
    //
  }

  async addCommits(): Promise<AckCommitsEvent> {
    return { type: 'ack', refs: [], syncId: '' };
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
  it('handle empty update call', async () => {
    const fn = jest.fn();
    const store = new MockLocalStore(fn);
    await store.update([], undefined);
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "refs": Array [],
            "syncId": "",
            "type": "ack",
          },
        ],
      ]
    `);
  });
});
