import {
  computeRef,
  diff,
  mergeAllBranches,
  migrate,
  patch,
} from './testLib/MergeUtils';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { SyncStatus } from './types';
import { timeout } from './lib/Timeout';
import { resetAll } from './testLib/MemoryBroadcastChannel';

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

const stores = new Set<MemoryStore<TestMetadata, Delta, TestPresence>>();

afterEach(async () => {
  for (const store of stores) {
    await store.shutdown();
  }
  stores.clear();
  resetAll();
});

function newStore(
  remote?: MemoryStore<TestMetadata, Delta, TestPresence>,
  online?: boolean,
) {
  const store = new MemoryStore<TestMetadata, Delta, TestPresence>(
    undefined,
    remote?.getRemote,
    online,
  );
  stores.add(store);
  return store;
}

function makeClient(
  userId: string,
  clientId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<TestSavedDoc, TestDoc, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, clientId, store.getLocalStore, differ);
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

function basicClients(
  client1: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestMetadata,
    Delta,
    TestPresence
  >,
): Record<string, TestPresence> {
  const obj: Record<string, TestPresence> = {};
  for (const client of client1.clients) {
    obj[`${client.userId}:${client.clientId}`] = client.presence;
  }
  return obj;
}

function newRemoteStore(online?: boolean) {
  return newStore(undefined, online);
}

describe('Remote sync', () => {
  jest.setTimeout(30000);
  it('syncs one client to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    client.updateDoc({}, 'initialize');
    client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`Array []`);
    expect(syncUpdates).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "loading",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "pending",
  },
]
`);
  });
  it('handles shutdown while connecting', async () => {
    const remoteStore = newRemoteStore(false);
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);
    await timeout();
    await client.shutdown();
  });

  it('syncs local pending changes in batches', async () => {
    const remoteStore = newRemoteStore(false);
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);
    client.updateDoc({}, 'initialize');
    client.updateDoc({ hello: 'world' }, 'add hello');
    client.updateDoc({ hello: 'world 2' }, 'edit hello');
    client.updateDoc({ hello: 'world 3' }, 'edit hello');
    client.updateDoc({ hello: 'world 4' }, 'edit hello');
    client.updateDoc({ hello: 'world 5' }, 'edit hello');
    client.updateDoc({ hello: 'world 6' }, 'edit hello');
    client.updateDoc({ hello: 'world 7' }, 'edit hello');
    client.updateDoc({ hello: 'world 8' }, 'edit hello');

    await timeout();

    remoteStore.online = true;

    // Wait for reconnect
    await timeout(50);

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`Array []`);
  });

  it('syncs two clients to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);

    const syncUpdates1: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));
    const client1Sub = jest.fn();
    client1.subscribeClientList(client1Sub);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const client2 = makeClient('test', 'b', localStore);

    const syncUpdates2: SyncStatus[] = [];
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));
    const client2Sub = jest.fn();
    client2.subscribeClientList(client2Sub);

    await timeout();

    expect(syncUpdates1).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "loading",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "saving",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "pending",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "pending",
  },
]
`);
    expect(syncUpdates2).toMatchInlineSnapshot(`
Array [
  Object {
    "localRead": "loading",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
  Object {
    "localRead": "ready",
    "localSave": "ready",
    "remoteConnect": "offline",
    "remoteRead": "loading",
    "remoteSave": "ready",
  },
]
`);
    expect(client1Sub.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    Array [
      Object {
        "clientId": "a",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "test",
      },
    ],
    Object {
      "origin": "subscribe",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "a",
        "presence": undefined,
        "ref": "Zob0dMmD",
        "self": true,
        "userId": "test",
      },
    ],
    Object {
      "origin": "self",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "a",
        "presence": undefined,
        "ref": "Zob0dMmD",
        "self": true,
        "userId": "test",
      },
    ],
    Object {
      "origin": "self",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "a",
        "presence": undefined,
        "ref": "leySPlIR",
        "self": true,
        "userId": "test",
      },
    ],
    Object {
      "origin": "self",
    },
  ],
  Array [
    Array [
      Object {
        "clientId": "a",
        "presence": undefined,
        "ref": "leySPlIR",
        "self": true,
        "userId": "test",
      },
    ],
    Object {
      "origin": "self",
    },
  ],
]
`);
    expect(client2Sub.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    Array [
      Object {
        "clientId": "b",
        "presence": undefined,
        "ref": undefined,
        "self": true,
        "userId": "test",
      },
    ],
    Object {
      "origin": "subscribe",
    },
  ],
]
`);
  });

  it('syncs two clients to remote with a local split', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);
    const client2 = makeClient('test', 'b', localStore);

    const states1: TestDoc[] = [];
    client1.subscribeDoc((state) => states1.push(state));
    const states2: TestDoc[] = [];
    client2.subscribeDoc((state) => states2.push(state));

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    expect(states1).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {},
        Object {
          "hello": "world",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
Array [
  undefined,
]
`);

    localStore.localNetworkPaused = true;

    await timeout();

    client2.updateDoc({ hello: 'world', world: 'hello' }, 'add world');

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {},
        Object {
          "hello": "world",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
Array [
  undefined,
  Object {
    "hello": "world",
    "world": "hello",
  },
]
`);

    localStore.localNetworkPaused = false;

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
Array [
  undefined,
  Object {},
  Object {
    "hello": "world",
  },
]
`);
    expect(states2).toMatchInlineSnapshot(`
Array [
  undefined,
  Object {
    "hello": "world",
    "world": "hello",
  },
]
`);
  });

  it('syncs one client to a store multiple times', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    await client.updateDoc({}, 'initialize');
    await client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout(100);

    // Kill the "connection"
    remoteStore.remotes[0].fail('testing', 'network');

    const promises = [
      client.updateDoc({ hello: 'vorld' }, 'change hello'),
      client.updateDoc({ hello: 'borld' }, 'change hello'),
    ];

    const localGraph2 = basicGraph(localStore, client);
    const remoteGraph2 = basicGraph(remoteStore, client);
    expect(remoteGraph2).toEqual(localGraph2);

    await Promise.all(promises);

    const localGraph3 = basicGraph(localStore, client);
    expect(localGraph3).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> Zob0dMmD",
          "step": "initialize",
          "value": Object {},
        },
        Object {
          "graph": "Zob0dMmD -> leySPlIR",
          "step": "add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "leySPlIR -> x_n2sT7P",
          "step": "change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
        Object {
          "graph": "x_n2sT7P -> IkVWMaAr",
          "step": "change hello",
          "value": Object {
            "hello": "borld",
          },
        },
      ]
    `);

    // Need to wait longer for the "reconnect"
    await timeout(100);

    const remoteGraph3 = basicGraph(remoteStore, client);
    expect(remoteGraph3).toEqual(localGraph3);

    expect(syncUpdates).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "connecting",
          "remoteRead": "offline",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "offline",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
      ]
    `);
  });

  it('handles leader network split', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);
    const client2 = makeClient('test', 'b', localStore);

    const syncUpdates: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates.push(state));

    localStore.localNetworkPaused = true;

    expect(client1.isRemoteLeader).toBe(false);
    expect(client2.isRemoteLeader).toBe(false);

    // wait for election
    await timeout(100);

    expect(client1.isRemoteLeader).toBe(true);
    expect(client2.isRemoteLeader).toBe(true);

    expect(client1.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    localStore.localNetworkPaused = false;

    await timeout(100);

    expect(client1.isRemoteLeader).toBe(true);
    expect(client2.isRemoteLeader).toBe(false);

    expect(client1.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);
  });

  it('syncs two client stores to a remote store', async () => {
    const remoteStore = newStore();
    const store1 = newStore(remoteStore);
    const store2 = newStore(remoteStore);
    const client1 = makeClient('a', 'a', store1);
    const client2 = makeClient('b', 'b', store2);

    const syncUpdates1: SyncStatus[] = [];
    const syncUpdates2: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));

    const client1ListSub = jest.fn();
    const client2ListSub = jest.fn();

    client1.subscribeClientList(client1ListSub);
    client2.subscribeClientList(client2ListSub);

    client1.updateDoc({}, 'initialize');
    client1.updateDoc({ hello: 'world' }, 'add hello');
    client1.updateDoc({ hello: 'vorld' }, 'change hello');

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);

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

    const graph1 = basicGraph(store1, client1);
    const graph2 = basicGraph(store2, client1);
    expect(graph1).toMatchInlineSnapshot(`
      Array [
        Object {
          "graph": "undefined -> Zob0dMmD",
          "step": "initialize",
          "value": Object {},
        },
        Object {
          "graph": "Zob0dMmD -> leySPlIR",
          "step": "add hello",
          "value": Object {
            "hello": "world",
          },
        },
        Object {
          "graph": "leySPlIR -> x_n2sT7P",
          "step": "change hello",
          "value": Object {
            "hello": "vorld",
          },
        },
        Object {
          "graph": "x_n2sT7P -> iOywLlrW",
          "step": "add world",
          "value": Object {
            "hello": "vorld",
            "world": "world",
          },
        },
        Object {
          "graph": "iOywLlrW -> ZLVXz73q",
          "step": "change world",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      ]
    `);
    expect(graph2).toEqual(graph1);

    await client1.shutdown();
    await client2.shutdown();

    expect(syncUpdates1).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
      ]
    `);
    expect(syncUpdates2).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
      ]
    `);
    expect(client1ListSub.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Array [
            Object {
              "clientId": "a",
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
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "userId": "b",
            },
          ],
          Object {
            "origin": "remote",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "iOywLlrW",
              "userId": "b",
            },
          ],
          Object {
            "origin": "remote",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "userId": "b",
            },
          ],
          Object {
            "origin": "remote",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
          ],
          Object {
            "origin": "remote",
          },
        ],
      ]
    `);
    expect(client2ListSub.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Array [
            Object {
              "clientId": "b",
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
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          Object {
            "origin": "remote",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "iOywLlrW",
              "self": true,
              "userId": "b",
            },
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "iOywLlrW",
              "self": true,
              "userId": "b",
            },
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "self": true,
              "userId": "b",
            },
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "self": true,
              "userId": "b",
            },
            Object {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          Object {
            "origin": "self",
          },
        ],
        Array [
          Array [
            Object {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "self": true,
              "userId": "b",
            },
          ],
          Object {
            "origin": "remote",
          },
        ],
      ]
    `);
  });

  it('syncs three clients with two local stores', async () => {
    const remoteStore = newStore();
    const localStore1 = newStore(remoteStore);
    const localStore2 = newStore(remoteStore);
    const client1 = makeClient('a', 'client1', localStore1);
    const client2 = makeClient('b', 'client2', localStore2);
    const client3 = makeClient('b', 'client3', localStore2);

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      Object {
        "a:client1": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      Object {
        "b:client2": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      Object {
        "b:client3": undefined,
      }
    `);

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
Object {
  "a:client1": undefined,
}
`);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
Object {
  "b:client2": undefined,
}
`);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
Object {
  "b:client3": undefined,
}
`);

    client1.updatePresence('presence 1');
    client2.updatePresence('presence 2');
    client3.updatePresence('presence 3');

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
Object {
  "a:client1": "presence 1",
}
`);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
Object {
  "b:client2": "presence 2",
}
`);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
Object {
  "b:client3": "presence 3",
}
`);
  });
});
