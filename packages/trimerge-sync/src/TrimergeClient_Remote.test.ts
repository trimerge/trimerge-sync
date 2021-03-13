import { computeRef, diff, merge, patch, timeout } from './testLib/MergeUtils';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { getBasicGraph } from './testLib/GraphVisualizers';

type TestEditMetadata = string;
type TestState = any;
type TestCursorState = any;

const differ: Differ<TestState, TestEditMetadata, TestCursorState> = {
  diff,
  patch,
  computeRef,
  merge,
};

function newStore(
  remote?: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
) {
  return new MemoryStore<TestEditMetadata, Delta, TestCursorState>(
    undefined,
    remote?.getSyncBackend,
  );
}

function makeClient(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestCursorState> {
  return new TrimergeClient(userId, 'test', store.getSyncBackend, differ, 0);
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
  client1: TrimergeClient<TestState, TestEditMetadata, Delta, TestCursorState>,
) {
  return getBasicGraph(
    store,
    (node) => node.editMetadata,
    (node) => client1.getNodeState(node.ref).value,
  );
}

describe('Remote sync', () => {
  it('syncs two clients to a store', async () => {
    const remoteStore = newStore();
    const store1 = newStore(remoteStore);
    const store2 = newStore(remoteStore);
    const client1 = makeClient('a', store1);
    const client2 = makeClient('b', store2);

    client1.updateState({}, 'initialize');
    client1.updateState({ hello: 'world' }, 'add hello');
    client1.updateState({ hello: 'vorld' }, 'change hello');

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual(undefined);

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

    expect(basicGraph(store1, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> YYUSBDXS",
          "step": "User a: change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
      ]
    `);
    expect(basicGraph(store2, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "YYUSBDXS -> YFIigfVr",
          "step": "User b: add world",
          "value": Object {
            "hello": "vorld",
            "world": "world",
          },
        },
        Object {
          "graph": "YFIigfVr -> 3duBmH5E",
          "step": "User b: change world",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      ]
    `);
  });
});
