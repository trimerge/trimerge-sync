import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { diff, merge, migrate, patch } from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';

type TestEditMetadata = { ref: string; message: string };
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const differ: Differ<TestSavedDoc, TestDoc, TestEditMetadata, TestPresence> = {
  migrate,
  diff,
  patch,
  computeRef: (baseRef, mergeRef, delta, editMetadata) => editMetadata.ref,
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
    (commit) => commit.editMetadata.message,
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
    expect(clientA.state).toEqual({ text: '' });
    expect(clientB.state).toEqual({ text: '' });
    expect(clientC.state).toEqual({ text: '' });

    clientA.updateDoc({ text: 'a' }, { ref: 'a1', message: 'set text' });
    clientB.updateDoc({ text: 'b' }, { ref: 'b1', message: 'set text' });
    clientC.updateDoc({ text: 'c' }, { ref: 'c1', message: 'set text' });

    // Now client 1 and client 2 have different changes
    expect(clientA.state).toEqual({ text: 'a' });
    expect(clientB.state).toEqual({ text: 'b' });
    expect(clientC.state).toEqual({ text: 'c' });

    await timeout();

    expect(basicGraph(store, clientA)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> ROOT",
          "step": "User a: init",
          "value": Object {
            "text": "",
          },
        },
        Object {
          "graph": "ROOT -> a1",
          "step": "User a: set text",
          "value": Object {
            "text": "a",
          },
        },
        Object {
          "graph": "ROOT -> b1",
          "step": "User b: set text",
          "value": Object {
            "text": "b",
          },
        },
        Object {
          "graph": "(a1 + b1) w/ base=ROOT -> (a1+b1)",
          "step": "User b: merge",
          "value": Object {
            "text": "ab",
          },
        },
        Object {
          "graph": "ROOT -> c1",
          "step": "User c: set text",
          "value": Object {
            "text": "c",
          },
        },
        Object {
          "graph": "(a1 + c1) w/ base=ROOT -> (a1+c1)",
          "step": "User c: merge",
          "value": Object {
            "text": "ac",
          },
        },
        Object {
          "graph": "((a1+b1) + (a1+c1)) w/ base=a1 -> ((a1+b1)+(a1+c1))",
          "step": "User c: merge",
          "value": Object {
            "text": "abc",
          },
        },
      ]
    `);

    //  Now they should all have trimerged changes
    expect(clientA.state).toEqual({ text: 'abc' });
    expect(clientB.state).toEqual({ text: 'abc' });
    expect(clientC.state).toEqual({ text: 'abc' });

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
    expect(clientA.state).toEqual({ hello: 'vorld' });
    expect(clientB.state).toEqual({ world: 'vorld' });

    const clientC = makeClient('c', store);
    expect(clientC.state).toEqual(undefined);

    await timeout();

    //  Now they should all have the trimerged state
    expect(clientA.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(clientB.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(clientC.state).toEqual({ hello: 'vorld', world: 'vorld' });

    clientC.updateDoc(
      { hello: 'world', world: 'vorld' },
      { ref: 'c1', message: 'change hello' },
    );

    await timeout();

    expect(basicGraph(store, clientA)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> a1",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "a1 -> a2",
          "step": "User a: change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
        Object {
          "graph": "undefined -> b1",
          "step": "User b: add world",
          "value": Object {
            "world": "world",
          },
        },
        Object {
          "graph": "b1 -> b2",
          "step": "User b: change world",
          "value": Object {
            "world": "vorld",
          },
        },
        Object {
          "graph": "(a2 + b2) w/ base=undefined -> (a2+b2)",
          "step": "User b: merge",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
        Object {
          "graph": "(a2+b2) -> c1",
          "step": "User c: change hello",
          "value": Object {
            "hello": "world",
            "world": "vorld",
          },
        },
      ]
    `);
  });
});
