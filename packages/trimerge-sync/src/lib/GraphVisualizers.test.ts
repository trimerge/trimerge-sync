import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from '../TrimergeClient';
import { MemoryStore } from '../testLib/MemoryStore';
import { getBasicGraph, getDotGraph } from './GraphVisualizers';
import { timeout } from './Timeout';
import { Commit } from '../types';
import {
  TEST_OPTS,
  TestDoc,
  TestPresence,
  TestSavedDoc,
} from '../testLib/MergeUtils';

type TestMetadata = string;

function newStore() {
  return new MemoryStore<TestMetadata, Delta, TestPresence>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<TestSavedDoc, TestDoc, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', {
    ...TEST_OPTS,
    getLocalStore: store.getLocalStore,
  });
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

function getTestDotGraph(
  commits: Iterable<Commit<any, Delta>>,
  getEditLabel: (commit: Commit<any, Delta>) => string,
) {
  return getDotGraph(
    commits,
    getEditLabel,
    (commit) => commit.ref,
    () => 'test user',
    () => false,
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
  return getTestDotGraph(store.getCommits(), (commit) =>
    JSON.stringify(client1.getCommitDoc(commit.ref).doc),
  ).graph;
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
      \\"X1xFORPw\\" [shape=ellipse, label=\\"X1xFORPw\\", color=black, fillcolor=azure, style=filled]
      \\"OscPQkG7:F7kQ39Rs\\" [shape=ellipse, label=\\"OscPQkG7:F7kQ39Rs (2 commits)\\", color=black, fillcolor=azure, style=filled]
      }"
    `);
  });

  it('merges commits correctly', async () => {
    const commits: Commit<any, any>[] = [
      {
        ref: '1',
        delta: '',
        metadata: 'first',
      },
      {
        ref: '2',
        baseRef: '1',
        delta: '',
        metadata: 'second',
      },
      {
        ref: '3',
        baseRef: '2',
        delta: '',
        metadata: 'third',
      },
      {
        ref: '4',
        baseRef: '3',
        delta: '',
        metadata: 'fourth',
      },
    ];

    expect(getTestDotGraph(commits, (commit) => commit.metadata).graph)
      .toMatchInlineSnapshot(`
      "digraph {
      \\"1:4\\" [shape=ellipse, label=\\"1:4 (4 commits)\\", color=black, fillcolor=azure, style=filled]
      }"
    `);
  });

  it('handles merge commits correctly', async () => {
    const commits: Commit<any, any>[] = [
      {
        ref: '1',
        delta: '',
        metadata: 'first',
      },
      {
        ref: '2',
        baseRef: '1',
        delta: '',
        metadata: 'second',
      },
      {
        ref: '3',
        baseRef: '1',
        delta: '',
        metadata: 'third',
      },
      {
        ref: '4',
        baseRef: '3',
        mergeRef: '2',
        delta: '',
        metadata: 'fourth',
      },
    ];

    expect(getTestDotGraph(commits, (commit) => commit.metadata).graph)
      .toMatchInlineSnapshot(`
      "digraph {
      \\"1\\" [shape=ellipse, label=\\"1\\", color=black, fillcolor=azure, style=filled]
      \\"2\\" [shape=ellipse, label=\\"2\\", color=black, fillcolor=azure, style=filled]
      \\"1\\" -> \\"2\\" [label=\\"second\\"]
      \\"3\\" [shape=ellipse, label=\\"3\\", color=black, fillcolor=azure, style=filled]
      \\"1\\" -> \\"3\\" [label=\\"third\\"]
      \\"4\\" [shape=rectangle, label=\\"4\\", color=black, fillcolor=azure, style=filled]
      \\"3\\" -> \\"4\\" [label=left]
      \\"2\\" -> \\"4\\" [label=right]
      }"
    `);
  });

  it('handles merge commits correctly', async () => {
    const commits: Commit<any, any>[] = [
      {
        ref: '1',
        delta: '',
        metadata: 'first',
      },
      {
        ref: '2',
        baseRef: '1',
        delta: '',
        metadata: 'second',
      },
      {
        ref: '3',
        baseRef: '2',
        delta: '',
        metadata: 'third',
      },
      {
        ref: '4',
        baseRef: '3',
        delta: '',
        metadata: 'fourth',
      },
      {
        ref: '5',
        baseRef: '4',
        delta: '',
        metadata: 'fifth',
      },
      {
        ref: '3prime',
        baseRef: '2',
        delta: '',
        metadata: 'fifth',
      },
      {
        ref: '4prime',
        baseRef: '3prime',
        delta: '',
        metadata: 'sixth',
      },
      {
        ref: '5prime',
        baseRef: '4prime',
        delta: '',
        metadata: 'seventh',
      },
      {
        ref: 'merged4s',
        baseRef: '4',
        mergeRef: '4prime',
        delta: '',
        metadata: 'eighth',
      },
    ];

    expect(getTestDotGraph(commits, (commit) => commit.metadata).graph)
      .toMatchInlineSnapshot(`
      "digraph {
      \\"1\\" [shape=ellipse, label=\\"1\\", color=black, fillcolor=azure, style=filled]
      \\"2\\" [shape=ellipse, label=\\"2\\", color=black, fillcolor=azure, style=filled]
      \\"1\\" -> \\"2\\" [label=\\"second\\"]
      \\"3\\" [shape=ellipse, label=\\"3\\", color=black, fillcolor=azure, style=filled]
      \\"2\\" -> \\"3\\" [label=\\"third\\"]
      \\"4\\" [shape=ellipse, label=\\"4\\", color=black, fillcolor=azure, style=filled]
      \\"3\\" -> \\"4\\" [label=\\"fourth\\"]
      \\"5\\" [shape=ellipse, label=\\"5\\", color=black, fillcolor=azure, style=filled]
      \\"4\\" -> \\"5\\" [label=\\"fifth\\"]
      \\"3prime\\" [shape=ellipse, label=\\"3prime\\", color=black, fillcolor=azure, style=filled]
      \\"2\\" -> \\"3prime\\" [label=\\"fifth\\"]
      \\"4prime\\" [shape=ellipse, label=\\"4prime\\", color=black, fillcolor=azure, style=filled]
      \\"3prime\\" -> \\"4prime\\" [label=\\"sixth\\"]
      \\"5prime\\" [shape=ellipse, label=\\"5prime\\", color=black, fillcolor=azure, style=filled]
      \\"4prime\\" -> \\"5prime\\" [label=\\"seventh\\"]
      \\"merged4s\\" [shape=rectangle, label=\\"merged4s\\", color=black, fillcolor=azure, style=filled]
      \\"4\\" -> \\"merged4s\\" [label=left]
      \\"4prime\\" -> \\"merged4s\\" [label=right]
      }"
    `);
  });

  it('doesnt merge merge commits into a metanode', async () => {
    const commits: Commit<any, any>[] = [
      {
        ref: '1',
        delta: '',
        metadata: 'first',
      },
      {
        ref: '2',
        baseRef: '1',
        delta: '',
        metadata: 'second',
      },
      {
        ref: '2prime',
        baseRef: '1',
        delta: '',
        metadata: 'third',
      },
      {
        ref: '3',
        baseRef: '2',
        delta: '',
        metadata: 'fourth',
      },
      {
        ref: '4',
        baseRef: '3',
        delta: '',
        metadata: 'fifth',
      },
      {
        ref: '5',
        baseRef: '4',
        mergeRef: '2prime',
        metadata: 'sixth',
      },
    ];

    expect(getTestDotGraph(commits, (commit) => commit.metadata).graph)
      .toMatchInlineSnapshot(`
      "digraph {
      \\"1\\" [shape=ellipse, label=\\"1\\", color=black, fillcolor=azure, style=filled]
      \\"2:4\\" [shape=ellipse, label=\\"2:4 (3 commits)\\", color=black, fillcolor=azure, style=filled]
      \\"1\\" -> \\"2:4\\" [label=\\"\\"]
      \\"2prime\\" [shape=ellipse, label=\\"2prime\\", color=black, fillcolor=azure, style=filled]
      \\"1\\" -> \\"2prime\\" [label=\\"third\\"]
      \\"5\\" [shape=rectangle, label=\\"5\\", color=black, fillcolor=azure, style=filled]
      \\"2:4\\" -> \\"5\\" [label=left]
      \\"2prime\\" -> \\"5\\" [label=right]
      }"
    `);
  });
});
