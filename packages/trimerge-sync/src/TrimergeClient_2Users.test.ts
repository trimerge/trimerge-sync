import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { computeRef, diff, merge, patch, timeout } from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';

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

describe('TrimergeClient: 2 users', () => {
  it('tracks edits', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    client.addEdit({}, 'initialize');
    client.addEdit({ hello: 'world' }, 'add hello');
    client.addEdit({ hello: 'vorld' }, 'change hello');

    expect(client.state).toEqual({ hello: 'vorld' });
  });

  it('edit syncs across two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    // No values
    expect(client1.state).toBe(undefined);
    expect(client2.state).toBe(undefined);

    client1.addEdit({}, 'initialize');

    // Client 1 is updated, but not client2
    expect(client1.state).toEqual({});
    expect(client2.state).toBe(undefined);

    await timeout();

    // Client2 is updated now
    expect(client1.state).toEqual({});
    expect(client2.state).toEqual({});
  });

  it('two edits sync across two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ edit: true }, 'edit');

    // Client 1 is updated, but not client2
    expect(client1.state).toEqual({ edit: true });
    expect(client2.state).toBe(undefined);

    await timeout();

    expect(client2.state).toEqual({ edit: true });
  });

  it('edit syncs back and forth with two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    client2.addEdit({ hello: 'vorld', world: 'world' }, 'add world');
    client2.addEdit({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('automatic merging if two clients edit simultaneously', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');

    await client1.sync();

    // Synchronized
    expect(client1.state).toEqual({});
    expect(client2.state).toEqual({});

    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    client2.addEdit({ world: 'world' }, 'add world');
    client2.addEdit({ world: 'vorld' }, 'change world');

    // Now client 1 and client 2 have different changes
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ world: 'vorld' });

    await timeout();

    //  Now they should both have trimerged changes
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    // Should be the same
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await client1.shutdown();
    await client2.shutdown();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> YYUSBDXS",
          "step": "User a: change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
        Object {
          "graph": "DuQe--Vh -> SU0_JahJ",
          "step": "User b: add world",
          "value": Object {
            "world": "world",
          },
        },
        Object {
          "graph": "SU0_JahJ -> ZiYUF2m8",
          "step": "User b: change world",
          "value": Object {
            "world": "vorld",
          },
        },
        Object {
          "graph": "(YYUSBDXS + ZiYUF2m8) w/ base=DuQe--Vh -> kT9Dv92V",
          "step": "User b: merge",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      ]
    `);
  });

  it('sync up when second client comes in later', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual(undefined);
    await timeout();
    expect(client2.state).toEqual({ hello: 'vorld' });

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> YYUSBDXS",
          "step": "User a: change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
      ]
    `);
  });

  it('subscription works', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const subscribeFn = jest.fn();

    const unsubscribeFn = client1.subscribeState(subscribeFn);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual(undefined);

    await timeout();

    client1.addEdit({ hello: 'there' }, 'change hello again');

    await timeout();

    unsubscribeFn();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> YYUSBDXS",
          "step": "User a: change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
        Object {
          "graph": "YYUSBDXS -> iSZbPHuf",
          "step": "User a: change hello again",
          "value": Object {
            "hello": "there",
          },
        },
      ]
    `);

    expect(subscribeFn.mock.calls).toEqual([
      [undefined],
      [{}],
      [{ hello: 'world' }],
      [{ hello: 'vorld' }],
      [{ hello: 'there' }],
    ]);
  });

  it('works with lots of character typing', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'world. t' }, 'typing');
    client1.addEdit({ hello: 'world. th' }, 'typing');
    client1.addEdit({ hello: 'world. thi' }, 'typing');
    client1.addEdit({ hello: 'world. this' }, 'typing');
    client1.addEdit({ hello: 'world. this ' }, 'typing');
    client1.addEdit({ hello: 'world. this i' }, 'typing');
    client1.addEdit({ hello: 'world. this is' }, 'typing');
    client1.addEdit({ hello: 'world. this is ' }, 'typing');
    client1.addEdit({ hello: 'world. this is a' }, 'typing');
    client1.addEdit({ hello: 'world. this is a t' }, 'typing');
    client1.addEdit({ hello: 'world. this is a te' }, 'typing');
    client1.addEdit({ hello: 'world. this is a tes' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test ' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test o' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of ' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of c' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of ch' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of cha' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of char' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of chara' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of charac' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of charact' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of characte' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of character' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of character.' }, 'typing');

    await timeout();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> DuQe--Vh",
          "step": "User a: initialize",
          "value": Object {},
        },
        Object {
          "graph": "DuQe--Vh -> u0wBto6f",
          "step": "User a: add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "u0wBto6f -> VS2jghNi",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. t",
          },
        },
        Object {
          "graph": "VS2jghNi -> 0fvI2ESx",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. th",
          },
        },
        Object {
          "graph": "0fvI2ESx -> Jz2-R6rz",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. thi",
          },
        },
        Object {
          "graph": "Jz2-R6rz -> -bTKiTst",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this",
          },
        },
        Object {
          "graph": "-bTKiTst -> GaWb8t2f",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this ",
          },
        },
        Object {
          "graph": "GaWb8t2f -> 9J_xBqJ4",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this i",
          },
        },
        Object {
          "graph": "9J_xBqJ4 -> SYH3X4jm",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is",
          },
        },
        Object {
          "graph": "SYH3X4jm -> Nl0PNGuX",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is ",
          },
        },
        Object {
          "graph": "Nl0PNGuX -> vlZhl6Vh",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a",
          },
        },
        Object {
          "graph": "vlZhl6Vh -> YxT5Gm6R",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a t",
          },
        },
        Object {
          "graph": "YxT5Gm6R -> F0g2iLQv",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a te",
          },
        },
        Object {
          "graph": "F0g2iLQv -> vKey2nks",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a tes",
          },
        },
        Object {
          "graph": "vKey2nks -> C9Ub6hg6",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test",
          },
        },
        Object {
          "graph": "C9Ub6hg6 -> ObcwRxBk",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test ",
          },
        },
        Object {
          "graph": "ObcwRxBk -> Y8mdIN_L",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test o",
          },
        },
        Object {
          "graph": "Y8mdIN_L -> L000b_2W",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of",
          },
        },
        Object {
          "graph": "L000b_2W -> tYpujZ6D",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of ",
          },
        },
        Object {
          "graph": "tYpujZ6D -> -SKX2OVN",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of c",
          },
        },
        Object {
          "graph": "-SKX2OVN -> ffe6ZCmD",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of ch",
          },
        },
        Object {
          "graph": "ffe6ZCmD -> 8PtNr3hx",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of cha",
          },
        },
        Object {
          "graph": "8PtNr3hx -> oLFFrO2p",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of char",
          },
        },
        Object {
          "graph": "oLFFrO2p -> 8Xt-akSw",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of chara",
          },
        },
        Object {
          "graph": "8Xt-akSw -> UU5J3Qq2",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of charac",
          },
        },
        Object {
          "graph": "UU5J3Qq2 -> Oo2NTgQE",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of charact",
          },
        },
        Object {
          "graph": "Oo2NTgQE -> ci7d46HK",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of characte",
          },
        },
        Object {
          "graph": "ci7d46HK -> 7_amDpeg",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of character",
          },
        },
        Object {
          "graph": "7_amDpeg -> dKj2TVjC",
          "step": "User a: typing",
          "value": Object {
            "hello": "world. this is a test of character.",
          },
        },
      ]
    `);
  });
});
