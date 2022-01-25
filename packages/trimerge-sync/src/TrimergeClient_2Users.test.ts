import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import {
  computeRef,
  diff,
  mergeAllBranches,
  migrate,
  patch,
} from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { ClientInfo } from './types';
import { timeout } from './lib/Timeout';

type TestEditMetadata = string;
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

function sortedClients(
  client: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestEditMetadata,
    Delta,
    TestPresence
  >,
) {
  return Array.from(client.clients).sort(clientSort);
}
function clientSort(
  a: ClientInfo<TestPresence>,
  b: ClientInfo<TestPresence>,
): -1 | 1 | 0 {
  if (a.userId !== b.userId) {
    return a.userId < b.userId ? -1 : 1;
  }
  if (a.clientId !== b.clientId) {
    return a.clientId < b.clientId ? -1 : 1;
  }
  return 0;
}

describe('TrimergeClient: 2 users', () => {
  it('tracks edits', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    client.updateDoc({}, 'initialize');
    client.updateDoc({ hello: 'world' }, 'add hello');
    client.updateDoc({ hello: 'vorld' }, 'change hello');

    expect(client.doc).toEqual({ hello: 'vorld' });

    await timeout();

    expect(basicGraph(store, client)).toMatchInlineSnapshot(`
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

  it('tracks non-edits', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    const onStateChange = jest.fn();
    const unsub = client.subscribeDoc(onStateChange);
    client.updateDoc(undefined, 'initialize');
    await timeout();
    client.updateDoc(undefined, 'initialize');
    await timeout();

    expect(onStateChange.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    undefined,
    Object {
      "origin": "subscribe",
    },
  ],
]
`);
    unsub();
  });
  it('tracks presence', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    const onStateChange = jest.fn();
    const unsub = client.subscribeClientList(onStateChange);
    client.updatePresence('blah');
    await timeout();

    expect(onStateChange.mock.calls.slice(-1)).toMatchInlineSnapshot(`
Array [
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": "blah",
        "ref": undefined,
        "self": true,
        "userId": "a",
      },
    ],
    Object {
      "origin": "self",
    },
  ],
]
`);
    unsub();
  });

  it('edit syncs across two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    // No values
    expect(client1.doc).toBe(undefined);
    expect(client2.doc).toBe(undefined);

    client1.updateDoc({}, 'initialize');

    // Client 1 is updated, but not client2
    expect(client1.doc).toEqual({});
    expect(client2.doc).toBe(undefined);

    await timeout();

    expect(client1.syncStatus).toEqual({
      localRead: 'ready',
      localSave: 'ready',
      remoteConnect: 'offline',
      remoteRead: 'offline',
      remoteSave: 'saving',
    });
    expect(client2.syncStatus).toMatchInlineSnapshot(
      {
        localRead: 'ready',
        localSave: 'ready',
        remoteConnect: 'offline',
        remoteRead: 'offline',
        remoteSave: 'saving',
      },
      `
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "offline",
        "remoteRead": "offline",
        "remoteSave": "saving",
      }
    `,
    );

    // Client2 is updated now
    expect(client1.doc).toEqual({});
    expect(client2.doc).toEqual({});
  });

  it('sends presence information correctly', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client1Sub = jest.fn();
    const client1Unsub = client1.subscribeClientList(client1Sub);

    const client2 = makeClient('b', store);
    const client2Sub = jest.fn();
    const client2Unsub = client2.subscribeClientList(client2Sub);

    // Initial values
    expect(client1.clients).toEqual([
      {
        userId: 'a',
        self: true,
        clientId: 'test',
      },
    ]);
    expect(client2.clients).toEqual([
      {
        userId: 'b',
        self: true,
        clientId: 'test',
      },
    ]);

    expect(client1Sub.mock.calls).toEqual([
      [
        [
          {
            userId: 'a',
            self: true,
            clientId: 'test',
          },
        ],
        { origin: 'subscribe' },
      ],
    ]);

    expect(client2Sub.mock.calls).toEqual([
      [
        [
          {
            userId: 'b',
            self: true,
            clientId: 'test',
          },
        ],
        { origin: 'subscribe' },
      ],
    ]);

    await timeout();

    // Client2 is updated now
    expect(sortedClients(client1)).toMatchInlineSnapshot(`
Array [
  Object {
    "clientId": "test",
    "presence": undefined,
    "ref": undefined,
    "self": true,
    "userId": "a",
  },
  Object {
    "clientId": "test",
    "presence": undefined,
    "ref": undefined,
    "userId": "b",
  },
]
`);
    expect(sortedClients(client2)).toMatchInlineSnapshot(`
Array [
  Object {
    "clientId": "test",
    "presence": undefined,
    "ref": undefined,
    "userId": "a",
  },
  Object {
    "clientId": "test",
    "presence": undefined,
    "ref": undefined,
    "self": true,
    "userId": "b",
  },
]
`);

    expect(client1Sub.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "a",
      },
    ],
    Object {
      "origin": "subscribe",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "a",
      },
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "userId": "b",
      },
    ],
    Object {
      "origin": "local",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "a",
      },
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "userId": "b",
      },
    ],
    Object {
      "origin": "local",
    },
  ],
]
`);
    expect(client2Sub.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "b",
      },
    ],
    Object {
      "origin": "subscribe",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "b",
      },
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "userId": "a",
      },
    ],
    Object {
      "origin": "local",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "b",
      },
      Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "userId": "a",
      },
    ],
    Object {
      "origin": "local",
    },
  ],
]
`);
    client1Unsub();
    client2Unsub();
  });

  it('handles client-leave', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    await timeout();

    expect(sortedClients(client2)).toEqual([
      {
        clientId: 'test',
        ref: undefined,
        state: undefined,
        userId: 'a',
      },
      {
        clientId: 'test',
        ref: undefined,
        self: true,
        state: undefined,
        userId: 'b',
      },
    ]);

    await client1.shutdown();

    expect(sortedClients(client2)).toEqual([
      {
        clientId: 'test',
        ref: undefined,
        self: true,
        state: undefined,
        userId: 'b',
      },
    ]);
  });

  it('updates presence information', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);
    // Initial values
    expect(client1.clients).toEqual([
      {
        userId: 'a',
        self: true,
        clientId: 'test',
      },
    ]);
    expect(client2.clients).toEqual([
      {
        userId: 'b',
        self: true,
        clientId: 'test',
      },
    ]);

    client1.updatePresence('hello');

    await timeout();

    expect(sortedClients(client1)).toEqual([
      {
        clientId: 'test',
        ref: undefined,
        self: true,
        presence: 'hello',
        userId: 'a',
      },
      {
        clientId: 'test',
        ref: undefined,
        presence: undefined,
        userId: 'b',
      },
    ]);
    expect(sortedClients(client2)).toEqual([
      {
        clientId: 'test',
        ref: undefined,
        presence: 'hello',
        userId: 'a',
      },
      {
        clientId: 'test',
        ref: undefined,
        self: true,
        presence: undefined,
        userId: 'b',
      },
    ]);
  });

  it('two edits sync across two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ edit: true }, 'edit');

    // Client 1 is updated, but not client2
    expect(client1.doc).toEqual({ edit: true });
    expect(client2.doc).toBe(undefined);

    await timeout();

    expect(client2.doc).toEqual({ edit: true });
  });

  it('edit syncs back and forth with two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'vorld' }, 'change hello');

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld' });

    client2.updateDoc({ hello: 'vorld', world: 'world' }, 'add world');
    client2.updateDoc({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('automatic merging if two clients edit simultaneously', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.updateDoc({}, 'initialize');

    // Synchronized
    expect(client1.doc).toEqual({});
    expect(client2.doc).toEqual(undefined);

    await timeout();

    expect(client2.doc).toEqual({});

    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'vorld' }, 'change hello');

    client2.updateDoc({ world: 'world' }, 'add world');
    client2.updateDoc({ world: 'vorld' }, 'change world');

    // Now client 1 and client 2 have different changes
    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ world: 'vorld' });

    await timeout();

    //  Now they should both have trimerged changes
    expect(client1.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    // Should be the same
    expect(client1.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

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
    "graph": "DuQe--Vh -> SU0_JahJ",
    "step": "User b: add world",
    "value": Object {
      "world": "world",
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
    "graph": "SU0_JahJ -> ZiYUF2m8",
    "step": "User b: change world",
    "value": Object {
      "world": "vorld",
    },
  },
]
`);
  });

  it('sync up when second client comes in later', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);
    await timeout();
    expect(client2.doc).toEqual({ hello: 'vorld' });

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

    const unsubscribeFn = client1.subscribeDoc(subscribeFn);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);

    await timeout();

    client1.updateDoc({ hello: 'there' }, 'change hello again');

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
      [undefined, { origin: 'subscribe' }],
      [{}, { origin: 'self' }],
      [{ hello: 'world' }, { origin: 'self' }],
      [{ hello: 'vorld' }, { origin: 'self' }],
      [{ hello: 'there' }, { origin: 'self' }],
    ]);
  });

  it('works with lots of character typing', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'world. t' }, 'typing');
    client1.updateDoc({ hello: 'world. th' }, 'typing');
    client1.updateDoc({ hello: 'world. thi' }, 'typing');
    client1.updateDoc({ hello: 'world. this' }, 'typing');
    client1.updateDoc({ hello: 'world. this ' }, 'typing');
    client1.updateDoc({ hello: 'world. this i' }, 'typing');
    client1.updateDoc({ hello: 'world. this is' }, 'typing');
    client1.updateDoc({ hello: 'world. this is ' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a t' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a te' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a tes' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test ' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test o' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of ' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of c' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of ch' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of cha' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of char' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of chara' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of charac' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of charact' }, 'typing');
    client1.updateDoc({ hello: 'world. this is a test of characte' }, 'typing');
    client1.updateDoc(
      { hello: 'world. this is a test of character' },
      'typing',
    );
    client1.updateDoc(
      { hello: 'world. this is a test of character.' },
      'typing',
    );

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
