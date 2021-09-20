import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from '../TrimergeClient';
import { Differ } from '../differ';
import { MemoryStore } from './MemoryStore';
import { computeRef, diff, merge, patch } from './MergeUtils';
import { getBasicGraph, getDotGraph } from './GraphVisualizers';
import { timeout } from '../lib/Timeout';

type TestEditMetadata = string;
type TestState = any;
type TestPresenceState = any;

const differ: Differ<TestState, TestEditMetadata, TestPresenceState> = {
  diff,
  patch,
  computeRef,
  merge,
};

function newStore() {
  return new MemoryStore<TestEditMetadata, Delta, TestPresenceState>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestPresenceState> {
  return new TrimergeClient(userId, 'test', store.getLocalStore, differ);
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
  client1: TrimergeClient<
    TestState,
    TestEditMetadata,
    Delta,
    TestPresenceState
  >,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.editMetadata,
    (node) => client1.getNodeState(node.ref).value,
  );
}

function dotGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
  client1: TrimergeClient<
    TestState,
    TestEditMetadata,
    Delta,
    TestPresenceState
  >,
) {
  return getDotGraph(
    store.getCommits(),
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
