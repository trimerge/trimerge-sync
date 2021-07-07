import { AbstractLocalStore } from './AbstractLocalStore';
import { AckNodesEvent, NodesEvent, OnEventFn } from './types';

class MockLocalStore extends AbstractLocalStore<unknown, unknown, unknown> {
  constructor(onEvent: OnEventFn<unknown, unknown, unknown> = () => undefined) {
    super('', '', onEvent);
  }
  async acknowledgeRemoteNodes(): Promise<void> {
    //
  }

  async addNodes(): Promise<AckNodesEvent> {
    throw new Error('unsupported');
  }

  async broadcastLocal(): Promise<void> {
    return Promise.resolve(undefined);
  }

  async getLastRemoteSyncId(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  async *getLocalNodes(): AsyncIterableIterator<
    NodesEvent<unknown, unknown, unknown>
  > {
    //
  }

  async *getNodesForRemote(): AsyncIterableIterator<
    NodesEvent<unknown, unknown, unknown>
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
});
