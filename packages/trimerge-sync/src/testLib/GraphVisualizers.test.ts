import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from '../TrimergeClient';
import { Differ } from '../differ';
import { MemoryStore } from './MemoryStore';
import {
  computeRef,
  diff,
  mergeAllBranches,
  migrate,
  patch,
} from './MergeUtils';
import { getBasicGraph, getDotGraph } from './GraphVisualizers';
import { timeout } from '../lib/Timeout';

type TestMetadata = string;
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const differ: Differ<TestSavedDoc, TestDoc, TestMetadata, TestPresence> = {
  migrate,
  diff,
  patch,
  computeRef,
  mergeAllBranches,
};

function newStore() {
  return new MemoryStore<TestMetadata, Delta, TestPresence>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<TestSavedDoc, TestDoc, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', store.getLocalStore, differ);
}

function basicGraph(
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestMetadata,
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
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestMetadata,
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

    void client1.updateDoc({ hello: '1' }, 'initialize');
    void client2.updateDoc({ world: '2' }, 'initialize');
    void client2.updateDoc({ world: '3' }, 'initialize');

    await timeout(100);

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> X1xFORPw",
    "step": "initialize",
    "value": Object {
      "hello": "1",
    },
  },
  Object {
    "graph": "undefined -> OscPQkG7",
    "step": "initialize",
    "value": Object {
      "world": "2",
    },
  },
  Object {
    "graph": "OscPQkG7 -> F7kQ39Rs",
    "step": "initialize",
    "value": Object {
      "world": "3",
    },
  },
]
`);
    expect(dotGraph(store, client1)).toMatchInlineSnapshot(`
"digraph {
\\"X1xFORPw\\" [shape=ellipse, label=\\"initialize\\"]
\\"OscPQkG7\\" [shape=ellipse, label=\\"initialize\\"]
\\"F7kQ39Rs\\" [shape=ellipse, label=\\"initialize\\"]
\\"OscPQkG7\\" -> \\"F7kQ39Rs\\" [label={\\"world\\":\\"3\\"}]
}"
`);
  });
});
