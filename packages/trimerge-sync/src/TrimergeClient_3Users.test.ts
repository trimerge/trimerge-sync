import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { diff, merge, patch } from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';

type TestEditMetadata = { ref: string; message: string };
type TestState = any;
type TestPresenceState = any;

const differ: Differ<TestState, TestEditMetadata, TestPresenceState> = {
  diff,
  patch,
  computeRef: (baseRef, mergeRef, delta, editMetadata) => editMetadata.ref,
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

function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
  clientA: TrimergeClient<
    TestState,
    TestEditMetadata,
    Delta,
    TestPresenceState
  >,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.editMetadata.message,
    (commit) => clientA.getCommitState(commit.ref).value,
  );
}

describe('TrimergeClient: 3 users', () => {
  it('simultaneous edit', async () => {
    const store = newStore();
    const clientA = makeClient('a', store);
    const clientB = makeClient('b', store);
    const clientC = makeClient('c', store);

    clientA.updateState({ text: '' }, { ref: 'ROOT', message: 'init' });

    await timeout();

    // Synchronized
    expect(clientA.state).toEqual({ text: '' });
    expect(clientB.state).toEqual({ text: '' });
    expect(clientC.state).toEqual({ text: '' });

    clientA.updateState({ text: 'a' }, { ref: 'a1', message: 'set text' });
    clientB.updateState({ text: 'b' }, { ref: 'b1', message: 'set text' });
    clientC.updateState({ text: 'c' }, { ref: 'c1', message: 'set text' });

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

    clientA.updateState(
      { hello: 'world' },
      { ref: 'a1', message: 'add hello' },
    );
    clientA.updateState(
      { hello: 'vorld' },
      { ref: 'a2', message: 'change hello' },
    );
    clientB.updateState(
      { world: 'world' },
      { ref: 'b1', message: 'add world' },
    );
    clientB.updateState(
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

    clientC.updateState(
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
