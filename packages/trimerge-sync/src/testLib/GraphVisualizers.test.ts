import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from '../TrimergeClient';
import { Differ } from '../differ';
import { MemoryStore } from './MemoryStore';
import { computeRef, diff, merge, patch, timeout } from './MergeUtils';
import { getBasicGraph, getDotGraph } from './GraphVisualizers';

type TestEditMetadata = string;
type TestState = any;
type TestCursorState = any;

const differ: Differ<TestState, TestEditMetadata, TestCursorState> = {
  initialState: undefined,
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

function dotGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
  client1: TrimergeClient<TestState, TestEditMetadata, Delta, TestCursorState>,
) {
  return getDotGraph(
    store,
    (node) => client1.getNodeState(node.ref).value,
    (node) => node.editMetadata,
  );
}

describe('GraphVisualizers', () => {
  it('getBasicGraph and getDotGraph', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);
    client1.updateState({ hello: '1' }, 'initialize');
    client2.updateState({ world: '2' }, 'initialize');
    client2.updateState({ world: '3' }, 'initialize');
    await timeout();
    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> 9m0LhHdt",
          "step": "User a: initialize",
          "value": Object {
            "hello": "1",
          },
        },
        Object {
          "graph": "undefined -> E2BlVX80",
          "step": "User b: initialize",
          "value": Object {
            "world": "2",
          },
        },
        Object {
          "graph": "E2BlVX80 -> yxbBldSG",
          "step": "User b: initialize",
          "value": Object {
            "world": "3",
          },
        },
        Object {
          "graph": "(9m0LhHdt + yxbBldSG) w/ base=undefined -> BAsEHbZm",
          "step": "User b: merge",
          "value": Object {
            "hello": "1",
            "world": "3",
          },
        },
      ]
    `);
    expect(dotGraph(store, client1)).toMatchInlineSnapshot(`
      "digraph {
      \\"9m0LhHdt\\" [shape=ellipse, label=\\"initialize\\"]
      \\"E2BlVX80\\" [shape=ellipse, label=\\"initialize\\"]
      \\"yxbBldSG\\" [shape=ellipse, label=\\"initialize\\"]
      \\"E2BlVX80\\" -> \\"yxbBldSG\\" [label=\\"User b: [object Object]\\"]
      \\"BAsEHbZm\\" [shape=rectangle, label={\\"ref\\":\\"(9m0LhHdt+yxbBldSG)\\",\\"message\\":\\"merge\\"}]
      \\"9m0LhHdt\\" -> \\"BAsEHbZm\\" [label=left]
      \\"undefined\\" -> \\"BAsEHbZm\\" [style=dashed, label=base]
      \\"yxbBldSG\\" -> \\"BAsEHbZm\\" [label=right]
      }"
    `);
  });
});
