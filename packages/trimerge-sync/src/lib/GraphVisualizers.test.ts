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
      [
        {
          "graph": "undefined -> X1xFORPw",
          "step": "initialize",
          "value": {
            "hello": "1",
          },
        },
        {
          "graph": "undefined -> OscPQkG7",
          "step": "initialize",
          "value": {
            "world": "2",
          },
        },
        {
          "graph": "OscPQkG7 -> F7kQ39Rs",
          "step": "initialize",
          "value": {
            "world": "3",
          },
        },
      ]
    `);
    expect(dotGraph(store, client1)).toMatchInlineSnapshot(`
      "digraph {
      "X1xFORPw" [shape=ellipse, label="X1xFORPw", color=black, fillcolor=azure, style=filled, id="X1xFORPw"];
      "OscPQkG7:F7kQ39Rs" [shape=ellipse, label="OscPQkG7:F7kQ39Rs (2 commits)", color=black, fillcolor=azure, style=filled, id="F7kQ39Rs"];
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
      "1:3" [shape=ellipse, label="1:3 (3 commits)", color=black, fillcolor=azure, style=filled, id="3"];
      "4" [shape=ellipse, label="4", color=black, fillcolor=azure, style=filled, id="4"];
      "1:3" -> "4" [label="fourth"]
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
      "1" [shape=ellipse, label="1", color=black, fillcolor=azure, style=filled, id="1"];
      "2" [shape=ellipse, label="2", color=black, fillcolor=azure, style=filled, id="2"];
      "1" -> "2" [label="second"]
      "3" [shape=ellipse, label="3", color=black, fillcolor=azure, style=filled, id="3"];
      "1" -> "3" [label="third"]
      "4" [shape=rectangle, label="4", color=black, fillcolor=azure, style=filled, id="4"];
      "3" -> "4" [label=left]
      "2" -> "4" [label=right]
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
      "1" [shape=ellipse, label="1", color=black, fillcolor=azure, style=filled, id="1"];
      "2" [shape=ellipse, label="2", color=black, fillcolor=azure, style=filled, id="2"];
      "1" -> "2" [label="second"]
      "3" [shape=ellipse, label="3", color=black, fillcolor=azure, style=filled, id="3"];
      "2" -> "3" [label="third"]
      "4" [shape=ellipse, label="4", color=black, fillcolor=azure, style=filled, id="4"];
      "3" -> "4" [label="fourth"]
      "5" [shape=ellipse, label="5", color=black, fillcolor=azure, style=filled, id="5"];
      "4" -> "5" [label="fifth"]
      "3prime" [shape=ellipse, label="3prime", color=black, fillcolor=azure, style=filled, id="3prime"];
      "2" -> "3prime" [label="fifth"]
      "4prime" [shape=ellipse, label="4prime", color=black, fillcolor=azure, style=filled, id="4prime"];
      "3prime" -> "4prime" [label="sixth"]
      "5prime" [shape=ellipse, label="5prime", color=black, fillcolor=azure, style=filled, id="5prime"];
      "4prime" -> "5prime" [label="seventh"]
      "merged4s" [shape=rectangle, label="merged4s", color=black, fillcolor=azure, style=filled, id="merged4s"];
      "4" -> "merged4s" [label=left]
      "4prime" -> "merged4s" [label=right]
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
      "1" [shape=ellipse, label="1", color=black, fillcolor=azure, style=filled, id="1"];
      "2:4" [shape=ellipse, label="2:4 (3 commits)", color=black, fillcolor=azure, style=filled, id="4"];
      "1" -> "2:4" [label=""]
      "2prime" [shape=ellipse, label="2prime", color=black, fillcolor=azure, style=filled, id="2prime"];
      "1" -> "2prime" [label="third"]
      "5" [shape=rectangle, label="5", color=black, fillcolor=azure, style=filled, id="5"];
      "2:4" -> "5" [label=left]
      "2prime" -> "5" [label=right]
      }"
    `);
  });

  it('does not merge with already referenced nodes', async () => {
    const commits: Commit<any, any>[] = [
      {
        graph: {
          ref: 'middle-merge-base-ref',
          delta: '',
        },
        edit: {
          message: 'blah',
        },
        server: {
          index: 1,
          main: false,
          timestamp: '2022-10-14T21:28:34.011Z',
        },
      },
      {
        graph: {
          ref: 'middle-merge-merge-ref',
          delta: '',
        },
        edit: {
          message: 'merged',
        },
        server: {
          index: 2,
          main: true,
          timestamp: '2022-10-14T21:28:34.011Z',
        },
      },
      {
        graph: {
          ref: 'middle-merge',
          baseRef: 'middle-merge-base-ref',
          mergeRef: 'middle-merge-merge-ref',
          delta: '',
        },
        edit: {
          message: 'merge',
        },
        server: {
          index: 3,
          main: true,
          timestamp: '2022-10-14T21:28:35.788Z',
        },
      },
      {
        graph: {
          ref: 'last-merge-base-ref',
          baseRef: 'middle-merge-base-ref',
          delta: '',
        },
        edit: {
          message: 'convert Overdub to audio',
        },
        server: {
          index: 4,
          main: false,
          timestamp: '2022-10-14T21:29:43.263Z',
        },
      },
      {
        graph: {
          ref: 'last-merge-2',
          baseRef: 'last-merge-base-ref',
          mergeRef: 'middle-merge',
          delta: '',
        },
        edit: {
          message: 'merge',
        },
        server: {
          index: 666,
          main: true,
          timestamp: '2022-10-14T21:29:44.911Z',
        },
      },
      {
        graph: {
          ref: 'last-merge-1',
          baseRef: 'last-merge-base-ref',
          mergeRef: 'middle-merge',
          delta: '',
        },
        edit: {
          message: 'merge',
        },
        server: {
          index: 680,
          main: false,
          timestamp: '2022-10-14T21:29:45.510Z',
        },
      },
    ].map((commit) => ({
      ref: commit.graph.ref,
      baseRef: commit.graph.baseRef,
      mergeRef: commit.graph.mergeRef,
      metadata: commit.edit.message,
    }));

    expect(getTestDotGraph(commits, (commit) => commit.metadata).graph)
      .toMatchInlineSnapshot(`
      "digraph {
      "middle-merge-base-ref" [shape=ellipse, label="middle-merge-base-ref", color=black, fillcolor=azure, style=filled, id="middle-merge-base-ref"];
      "middle-merge-merge-ref" [shape=ellipse, label="middle-merge-merge-ref", color=black, fillcolor=azure, style=filled, id="middle-merge-merge-ref"];
      "middle-merge" [shape=rectangle, label="middle-merge", color=black, fillcolor=azure, style=filled, id="middle-merge"];
      "middle-merge-base-ref" -> "middle-merge" [label=left]
      "middle-merge-merge-ref" -> "middle-merge" [label=right]
      "last-merge-base-ref" [shape=ellipse, label="last-merge-base-ref", color=black, fillcolor=azure, style=filled, id="last-merge-base-ref"];
      "middle-merge-base-ref" -> "last-merge-base-ref" [label="convert Overdub to audio"]
      "last-merge-2" [shape=rectangle, label="last-merge-2", color=black, fillcolor=azure, style=filled, id="last-merge-2"];
      "last-merge-base-ref" -> "last-merge-2" [label=left]
      "middle-merge" -> "last-merge-2" [label=right]
      "last-merge-1" [shape=rectangle, label="last-merge-1", color=black, fillcolor=azure, style=filled, id="last-merge-1"];
      "last-merge-base-ref" -> "last-merge-1" [label=left]
      "middle-merge" -> "last-merge-1" [label=right]
      }"
    `);
  });

  it('allows missing merge commits', async () => {
    const commits: Commit<any, any>[] = [
      {
        graph: {
          ref: 'middle-merge-base-ref',
          delta: '',
        },
        edit: {
          message: 'blah',
        },
        server: {
          index: 1,
          main: false,
          timestamp: '2022-10-14T21:28:34.011Z',
        },
      },
      {
        graph: {
          ref: 'middle-merge',
          baseRef: 'middle-merge-base-ref',
          mergeRef: 'middle-merge-merge-ref',
          delta: '',
        },
        edit: {
          message: 'merge',
        },
        server: {
          index: 3,
          main: true,
          timestamp: '2022-10-14T21:28:35.788Z',
        },
      },
      {
        graph: {
          ref: 'last-merge-base-ref',
          baseRef: 'middle-merge-base-ref',
          delta: '',
        },
        edit: {
          message: 'convert Overdub to audio',
        },
        server: {
          index: 4,
          main: false,
          timestamp: '2022-10-14T21:29:43.263Z',
        },
      },
      {
        graph: {
          ref: 'last-merge-2',
          baseRef: 'last-merge-base-ref',
          mergeRef: 'middle-merge',
          delta: '',
        },
        edit: {
          message: 'merge',
        },
        server: {
          index: 666,
          main: true,
          timestamp: '2022-10-14T21:29:44.911Z',
        },
      },
      {
        graph: {
          ref: 'last-merge-1',
          baseRef: 'last-merge-base-ref',
          mergeRef: 'middle-merge',
          delta: '',
        },
        edit: {
          message: 'merge',
        },
        server: {
          index: 680,
          main: false,
          timestamp: '2022-10-14T21:29:45.510Z',
        },
      },
    ].map((commit) => ({
      ref: commit.graph.ref,
      baseRef: commit.graph.baseRef,
      mergeRef: commit.graph.mergeRef,
      metadata: commit.edit.message,
    }));

    expect(getTestDotGraph(commits, (commit) => commit.metadata).graph)
      .toMatchInlineSnapshot(`
      "digraph {
      "middle-merge-base-ref" [shape=ellipse, label="middle-merge-base-ref", color=black, fillcolor=azure, style=filled, id="middle-merge-base-ref"];
      "middle-merge" [shape=rectangle, label="middle-merge", color=black, fillcolor=azure, style=filled, id="middle-merge"];
      "middle-merge-base-ref" -> "middle-merge" [label=left]
      "last-merge-base-ref" [shape=ellipse, label="last-merge-base-ref", color=black, fillcolor=azure, style=filled, id="last-merge-base-ref"];
      "middle-merge-base-ref" -> "last-merge-base-ref" [label="convert Overdub to audio"]
      "last-merge-2" [shape=rectangle, label="last-merge-2", color=black, fillcolor=azure, style=filled, id="last-merge-2"];
      "last-merge-base-ref" -> "last-merge-2" [label=left]
      "middle-merge" -> "last-merge-2" [label=right]
      "last-merge-1" [shape=rectangle, label="last-merge-1", color=black, fillcolor=azure, style=filled, id="last-merge-1"];
      "last-merge-base-ref" -> "last-merge-1" [label=left]
      "middle-merge" -> "last-merge-1" [label=right]
      }"
    `);
  });
});
