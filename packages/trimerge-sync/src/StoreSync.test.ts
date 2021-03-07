import { computeRef, diff, merge, patch, timeout } from './testLib/MergeUtils';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';

type TestEditMetadata = string;
type TestState = any;
type TestCursorState = any;

const differ: Differ<TestState, TestEditMetadata, TestCursorState> = {
  diff,
  patch,
  computeRef,
  merge,
};

function newStore() {
  return new MemoryStore<TestEditMetadata, Delta, TestCursorState>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestCursorState> {
  return new TrimergeClient(userId, 'test', store.getSyncBackend, differ, 0);
}

describe('StoreSync', () => {
  it('syncs across the network', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.updateState({}, 'initialize');
    client1.updateState({ hello: 'world' }, 'add hello');
    client1.updateState({ hello: 'vorld' }, 'change hello');

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    client2.updateState({ hello: 'vorld', world: 'world' }, 'add world');
    client2.updateState({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });
});
