import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from '../TrimergeClient';
import { Differ } from '../differ';
import { MemoryStore } from './MemoryStore';
import { computeRef, diff, merge, migrate, patch } from './MergeUtils';
import { getBasicGraph, getDotGraph } from './GraphVisualizers';
import { timeout } from '../lib/Timeout';

type TestEditMetadata = string;
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const differ: Differ<TestSavedDoc, TestDoc, TestEditMetadata, TestPresence> = {
  migrate,
  diff,
  patch,
  computeRef,
  merge,
};

function newStore() {
  return new MemoryStore<TestEditMetadata, Delta, TestPresence>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresence>,
): TrimergeClient<
  TestSavedDoc,
  TestDoc,
  TestEditMetadata,
  Delta,
  TestPresence
> {
  return new TrimergeClient(userId, 'test', store.getLocalStore, differ, 0);
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresence>,
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestEditMetadata,
    Delta,
    TestPresence
  >,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.metadata,
    (commit) => client1.getCommitDoc(commit.ref).doc,
  );
}

function dotGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresence>,
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestEditMetadata,
    Delta,
    TestPresence
  >,
) {
  return getDotGraph(
    store.getCommits(),
    (commit) => client1.getCommitDoc(commit.ref).doc,
    (commit) => commit.metadata,
  );
}

describe('GraphVisualizers', () => {
  it('getBasicGraph and getDotGraph', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);
    client1.updateDoc({ hello: '1' }, 'initialize');
    client2.updateDoc({ world: '2' }, 'initialize');
    client2.updateDoc({ world: '3' }, 'initialize');
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
