import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { MemoryStore } from './testLib/MemoryStore';
import {
  TEST_OPTS,
  TestDoc,
  TestPresence,
  TestSavedDoc,
} from './testLib/MergeUtils';
import { getBasicGraph } from './lib/GraphVisualizers';

type TestMetadata = { ref: string; message: string };

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

function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function basicGraph(
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
  clientA: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestMetadata,
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

    void clientA.updateDoc({ text: '' }, { ref: 'ROOT', message: 'init' });

    await timeout();

    // Synchronized
    expect(clientA.doc).toEqual({ text: '' });
    expect(clientB.doc).toEqual({ text: '' });
    expect(clientC.doc).toEqual({ text: '' });

    void clientA.updateDoc({ text: 'a' }, { ref: 'a1', message: 'set text' });
    void clientB.updateDoc({ text: 'b' }, { ref: 'b1', message: 'set text' });
    void clientC.updateDoc({ text: 'c' }, { ref: 'c1', message: 'set text' });

    // Now all clients have different changes
    expect(clientA.doc).toEqual({ text: 'a' });
    expect(clientB.doc).toEqual({ text: 'b' });
    expect(clientC.doc).toEqual({ text: 'c' });

    await timeout();

    expect(basicGraph(store, clientA)).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> wK5f8__5",
          "step": "init",
          "value": {
            "text": "",
          },
        },
        {
          "graph": "wK5f8__5 -> 8n57Fn1Z",
          "step": "set text",
          "value": {
            "text": "a",
          },
        },
        {
          "graph": "wK5f8__5 -> 97kyoTPd",
          "step": "set text",
          "value": {
            "text": "b",
          },
        },
        {
          "graph": "wK5f8__5 -> TL7mKxsx",
          "step": "set text",
          "value": {
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

    void clientA.updateDoc(
      { hello: 'world' },
      { ref: 'a1', message: 'add hello' },
    );
    void clientA.updateDoc(
      { hello: 'vorld' },
      { ref: 'a2', message: 'change hello' },
    );
    void clientB.updateDoc(
      { world: 'world' },
      { ref: 'b1', message: 'add world' },
    );
    void clientB.updateDoc(
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

    void clientC.updateDoc(
      { hello: 'world', world: 'vorld' },
      { ref: 'c1', message: 'change hello' },
    );

    await timeout();

    expect(basicGraph(store, clientA)).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> HgR3uUrD",
          "step": "add hello",
          "value": {
            "hello": "world",
          },
        },
        {
          "graph": "undefined -> AUJdfMae",
          "step": "add world",
          "value": {
            "world": "world",
          },
        },
        {
          "graph": "HgR3uUrD -> eaef2Px0",
          "step": "change hello",
          "value": {
            "hello": "vorld",
          },
        },
        {
          "graph": "AUJdfMae -> qOgOVi10",
          "step": "change world",
          "value": {
            "world": "vorld",
          },
        },
        {
          "graph": "(eaef2Px0 + qOgOVi10) w/ base=unknown -> yHC1lA3q",
          "step": "merge",
          "value": {
            "hello": "vorld",
            "world": "vorld",
          },
        },
        {
          "graph": "yHC1lA3q -> 7BcdoBW0",
          "step": "change hello",
          "value": {
            "hello": "world",
            "world": "vorld",
          },
        },
      ]
    `);
  });
});
