import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import {
  diff,
  mergeAllBranches,
  migrate,
  patch,
  computeRef,
} from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';

type TestEditMetadata = { ref: string; message: string };
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const differ: Differ<TestSavedDoc, TestDoc, TestEditMetadata, TestPresence> = {
  migrate,
  diff,
  patch,
  computeRef,
  mergeAllBranches,
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
  return new TrimergeClient(userId, 'test', store.getLocalStore, differ);
}

function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresence>,
  clientA: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestEditMetadata,
    Delta,
    TestPresence
  >,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.metadata.message,
    (commit) => clientA.getCommitDoc(commit.ref).doc,
  );
}

describe('TrimergeClient: 3 users', () => {
  it('simultaneous edit', async () => {
    const store = newStore();
    const clientA = makeClient('a', store);
    const clientB = makeClient('b', store);
    const clientC = makeClient('c', store);

    clientA.updateDoc({ text: '' }, { ref: 'ROOT', message: 'init' });

    await timeout();

    // Synchronized
    expect(clientA.doc).toEqual({ text: '' });
    expect(clientB.doc).toEqual({ text: '' });
    expect(clientC.doc).toEqual({ text: '' });

    clientA.updateDoc({ text: 'a' }, { ref: 'a1', message: 'set text' });
    clientB.updateDoc({ text: 'b' }, { ref: 'b1', message: 'set text' });
    clientC.updateDoc({ text: 'c' }, { ref: 'c1', message: 'set text' });

    // Now all clients have different changes
    expect(clientA.doc).toEqual({ text: 'a' });
    expect(clientB.doc).toEqual({ text: 'b' });
    expect(clientC.doc).toEqual({ text: 'c' });

    await timeout();

    expect(basicGraph(store, clientA)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> wK5f8__5",
    "step": "init",
    "value": Object {
      "text": "",
    },
  },
  Object {
    "graph": "wK5f8__5 -> 8n57Fn1Z",
    "step": "set text",
    "value": Object {
      "text": "a",
    },
  },
  Object {
    "graph": "wK5f8__5 -> 97kyoTPd",
    "step": "set text",
    "value": Object {
      "text": "b",
    },
  },
  Object {
    "graph": "wK5f8__5 -> TL7mKxsx",
    "step": "set text",
    "value": Object {
      "text": "c",
    },
  },
]
`);

    //  Now they should all have trimerged changes
    expect(clientA.doc).toEqual({ text: 'abc' });
    expect(clientB.doc).toEqual({ text: 'abc' });
    expect(clientC.doc).toEqual({ text: 'abc' });

    await clientA.shutdown();
    await clientB.shutdown();
    await clientC.shutdown();
  });

  it('first two clients conflict, then third one joins', async () => {
    const store = newStore();
    const clientA = makeClient('a', store);
    const clientB = makeClient('b', store);

    clientA.updateDoc({ hello: 'world' }, { ref: 'a1', message: 'add hello' });
    clientA.updateDoc(
      { hello: 'vorld' },
      { ref: 'a2', message: 'change hello' },
    );
    clientB.updateDoc({ world: 'world' }, { ref: 'b1', message: 'add world' });
    clientB.updateDoc(
      { world: 'vorld' },
      { ref: 'b2', message: 'change world' },
    );

    // Now client 1 and client 2 have different changes
    expect(clientA.doc).toEqual({ hello: 'vorld' });
    expect(clientB.doc).toEqual({ world: 'vorld' });

    const clientC = makeClient('c', store);
    expect(clientC.doc).toEqual(undefined);

    await timeout();

    //  Now they should all have the trimerged state
    expect(clientA.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(clientB.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(clientC.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    clientC.updateDoc(
      { hello: 'world', world: 'vorld' },
      { ref: 'c1', message: 'change hello' },
    );

    await timeout();

    expect(basicGraph(store, clientA)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> HgR3uUrD",
    "step": "add hello",
    "value": Object {
      "hello": "world",
    },
  },
  Object {
    "graph": "undefined -> AUJdfMae",
    "step": "add world",
    "value": Object {
      "world": "world",
    },
  },
  Object {
    "graph": "HgR3uUrD -> eaef2Px0",
    "step": "change hello",
    "value": Object {
      "hello": "vorld",
    },
  },
  Object {
    "graph": "AUJdfMae -> qOgOVi10",
    "step": "change world",
    "value": Object {
      "world": "vorld",
    },
  },
  Object {
    "graph": "(eaef2Px0 + qOgOVi10) w/ base=unknown -> yHC1lA3q",
    "step": "merge",
    "value": Object {
      "hello": "vorld",
      "world": "vorld",
    },
  },
  Object {
    "graph": "yHC1lA3q -> 7BcdoBW0",
    "step": "change hello",
    "value": Object {
      "hello": "world",
      "world": "vorld",
    },
  },
]
`);
  });
});
