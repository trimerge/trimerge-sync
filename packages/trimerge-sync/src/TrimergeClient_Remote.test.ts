import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { getBasicGraph } from './lib/GraphVisualizers';
import { SyncStatus } from './types';
import { timeout } from './lib/Timeout';
import { resetAll } from './testLib/MemoryBroadcastChannel';
import {
  TEST_OPTS,
  TestDoc,
  TestPresence,
  TestSavedDoc,
} from './testLib/MergeUtils';

type TestMetadata = string;

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
    remote?.getRemote.bind(remote),
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
  return new TrimergeClient(userId, clientId, {
    ...TEST_OPTS,
    localStore: store.getLocalStore({ userId, clientId }),
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

function syncStatusDiffs(syncUpdates: SyncStatus[]): Partial<SyncStatus>[] {
  const results: Partial<SyncStatus>[] = [];
  var lastUpdate: Partial<SyncStatus> = {};
  for (const update of syncUpdates) {
    const currUpdate = { ...update };
    for (const key of Object.keys(update) as (keyof SyncStatus)[]) {
      if (update[key] === lastUpdate[key]) {
        delete update[key];
      }
    }
    results.push(update);
    lastUpdate = currUpdate;
  }
  return results;
}

function newRemoteStore(online?: boolean) {
  return newStore(undefined, online);
}

describe('Remote sync', () => {
  it.only('syncs one client to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    void client.updateDoc({}, 'initialize');
    void client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> Zob0dMmD",
          "step": "initialize",
          "value": {},
        },
        {
          "graph": "Zob0dMmD -> leySPlIR",
          "step": "add hello",
          "value": {
            "hello": "world",
          },
        },
      ]
    `);
    expect(syncStatusDiffs(syncUpdates)).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localSave": "saving",
        },
        {
          "localRead": "ready",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "ready",
        },
        {
          "localSave": "ready",
        },
        {
          "remoteConnect": "connecting",
          "remoteCursor": "2",
        },
        {
          "remoteConnect": "online",
        },
        {
          "remoteRead": "ready",
        },
      ]
    `);
  });
  it.only('handles shutdown while connecting', async () => {
    const remoteStore = newRemoteStore(false);
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);
    await timeout();
    await client.shutdown();
  });

  it.only('syncs local pending changes in batches', async () => {
    const remoteStore = newRemoteStore(false);
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);
    void client.updateDoc({}, 'initialize');
    void client.updateDoc({ hello: 'world' }, 'add hello');
    void client.updateDoc({ hello: 'world 2' }, 'edit hello');
    void client.updateDoc({ hello: 'world 3' }, 'edit hello');
    void client.updateDoc({ hello: 'world 4' }, 'edit hello');
    void client.updateDoc({ hello: 'world 5' }, 'edit hello');
    void client.updateDoc({ hello: 'world 6' }, 'edit hello');
    void client.updateDoc({ hello: 'world 7' }, 'edit hello');
    void client.updateDoc({ hello: 'world 8' }, 'edit hello');

    await timeout();

    remoteStore.online = true;

    // Wait for reconnect
    await timeout(50);

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> Zob0dMmD",
          "step": "initialize",
          "value": {},
        },
        {
          "graph": "Zob0dMmD -> leySPlIR",
          "step": "add hello",
          "value": {
            "hello": "world",
          },
        },
        {
          "graph": "leySPlIR -> DWZJPKBc",
          "step": "edit hello",
          "value": {
            "hello": "world 2",
          },
        },
        {
          "graph": "DWZJPKBc -> EM9w-Vme",
          "step": "edit hello",
          "value": {
            "hello": "world 3",
          },
        },
        {
          "graph": "EM9w-Vme -> bPTFg9aG",
          "step": "edit hello",
          "value": {
            "hello": "world 4",
          },
        },
        {
          "graph": "bPTFg9aG -> SZgOrzaG",
          "step": "edit hello",
          "value": {
            "hello": "world 5",
          },
        },
        {
          "graph": "SZgOrzaG -> s9y6mchq",
          "step": "edit hello",
          "value": {
            "hello": "world 6",
          },
        },
        {
          "graph": "s9y6mchq -> DnqoAp6m",
          "step": "edit hello",
          "value": {
            "hello": "world 7",
          },
        },
        {
          "graph": "DnqoAp6m -> _fOHZjAT",
          "step": "edit hello",
          "value": {
            "hello": "world 8",
          },
        },
      ]
    `);
  });

  // stuck
  it('syncs two clients to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);

    const syncUpdates1: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));
    const client1Sub = jest.fn();
    client1.subscribeClientList(client1Sub);

    void client1.updateDoc({}, 'initialize');
    void client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const client2 = makeClient('test', 'b', localStore);

    const syncUpdates2: SyncStatus[] = [];
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));
    const client2Sub = jest.fn();
    client2.subscribeClientList(client2Sub);

    await timeout();

    expect(syncStatusDiffs(syncUpdates1)).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localRead": "loading",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "pending",
        },
        {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "connecting",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteCursor": "0",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteCursor": "0",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteCursor": "0",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
      ]
    `);
    expect(syncStatusDiffs(syncUpdates2)).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteCursor": undefined,
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteCursor": "0",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
      ]
    `);
    expect(client1Sub.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "test",
            },
          ],
          {
            "origin": "subscribe",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "self": true,
              "userId": "test",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "self": true,
              "userId": "test",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "test",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "test",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "test",
            },
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "userId": "test",
            },
          ],
          {
            "origin": "local",
          },
        ],
      ]
    `);
    expect(client2Sub.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "test",
            },
          ],
          {
            "origin": "subscribe",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "test",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "userId": "test",
            },
          ],
          {
            "origin": "local",
          },
        ],
      ]
    `);
  });

  // stuck
  it('syncs two clients to remote with a local split', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);
    const client2 = makeClient('test', 'b', localStore);

    const states1: TestDoc[] = [];
    client1.subscribeDoc((state) => states1.push(state));
    const states2: TestDoc[] = [];
    client2.subscribeDoc((state) => states2.push(state));

    void client1.updateDoc({}, 'initialize');
    void client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    expect(states1).toMatchInlineSnapshot(`
      [
        undefined,
        {},
        {
          "hello": "world",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
      [
        undefined,
        {},
        {
          "hello": "world",
        },
      ]
    `);

    localStore.localNetworkPaused = true;

    await timeout();

    void client2.updateDoc({ hello: 'world', world: 'hello' }, 'add world');

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
      [
        undefined,
        {},
        {
          "hello": "world",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
      [
        undefined,
        {},
        {
          "hello": "world",
        },
        {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);

    localStore.localNetworkPaused = false;

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
      [
        undefined,
        {},
        {
          "hello": "world",
        },
        {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
      [
        undefined,
        {},
        {
          "hello": "world",
        },
        {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);
  });

  it.only('syncs one client to a store multiple times', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    await client.updateDoc({}, 'initialize');
    await client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout(100);

    const localGraph2 = basicGraph(localStore, client);
    const remoteGraph2 = basicGraph(remoteStore, client);
    expect(remoteGraph2).toEqual(localGraph2);

    // Kill the "connection"
    remoteStore.remotes[0].fail('testing', 'network');

    const promises = [
      client.updateDoc({ hello: 'vorld' }, 'change hello'),
      client.updateDoc({ hello: 'borld' }, 'change hello'),
    ];

    await Promise.all(promises);

    const localGraph3 = basicGraph(localStore, client);
    expect(localGraph3).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> Zob0dMmD",
          "step": "initialize",
          "value": {},
        },
        {
          "graph": "Zob0dMmD -> leySPlIR",
          "step": "add hello",
          "value": {
            "hello": "world",
          },
        },
        {
          "graph": "leySPlIR -> x_n2sT7P",
          "step": "change hello",
          "value": {
            "hello": "vorld",
          },
        },
        {
          "graph": "x_n2sT7P -> IkVWMaAr",
          "step": "change hello",
          "value": {
            "hello": "borld",
          },
        },
      ]
    `);

    // Need to wait longer for the "reconnect"
    await timeout(100);

    const remoteGraph3 = basicGraph(remoteStore, client);
    expect(remoteGraph3).toEqual(localGraph3);

    expect(syncStatusDiffs(syncUpdates)).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localSave": "saving",
        },
        {
          "localRead": "ready",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "ready",
        },
        {
          "remoteSave": "saving",
        },
        {
          "localSave": "ready",
        },
        {
          "remoteSave": "ready",
        },
        {
          "remoteConnect": "connecting",
          "remoteCursor": "2",
        },
        {
          "remoteConnect": "online",
        },
        {
          "remoteRead": "ready",
        },
        {
          "localSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteConnect": "offline",
          "remoteRead": "offline",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "ready",
        },
        {
          "localSave": "ready",
        },
        {
          "remoteConnect": "connecting",
          "remoteCursor": "4",
        },
        {
          "remoteConnect": "online",
        },
        {
          "remoteRead": "ready",
        },
      ]
    `);
  });

  // stuck
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
      {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteCursor": "0",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteCursor": "0",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    localStore.localNetworkPaused = false;

    await timeout(100);

    expect(client1.isRemoteLeader).toBe(true);
    expect(client2.isRemoteLeader).toBe(false);

    expect(client1.syncStatus).toMatchInlineSnapshot(`
      {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteCursor": "0",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteCursor": "0",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);
  });

  it.only('syncs two client stores to a remote store', async () => {
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

    void client1.updateDoc({}, 'initialize');
    void client1.updateDoc({ hello: 'world' }, 'add hello');
    void client1.updateDoc({ hello: 'vorld' }, 'change hello');

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld' });

    void client2.updateDoc({ hello: 'vorld', world: 'world' }, 'add world');
    void client2.updateDoc({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld', world: 'vorld' });

    const graph1 = basicGraph(store1, client1);
    const graph2 = basicGraph(store2, client1);
    expect(graph1).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> Zob0dMmD",
          "step": "initialize",
          "value": {},
        },
        {
          "graph": "Zob0dMmD -> leySPlIR",
          "step": "add hello",
          "value": {
            "hello": "world",
          },
        },
        {
          "graph": "leySPlIR -> x_n2sT7P",
          "step": "change hello",
          "value": {
            "hello": "vorld",
          },
        },
        {
          "graph": "x_n2sT7P -> iOywLlrW",
          "step": "add world",
          "value": {
            "hello": "vorld",
            "world": "world",
          },
        },
        {
          "graph": "iOywLlrW -> ZLVXz73q",
          "step": "change world",
          "value": {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      ]
    `);
    expect(graph2).toEqual(graph1);

    await client1.shutdown();
    await client2.shutdown();

    expect(syncStatusDiffs(syncUpdates1)).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localSave": "saving",
        },
        {
          "localRead": "ready",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "ready",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "ready",
        },
        {
          "localSave": "ready",
        },
        {
          "remoteConnect": "connecting",
          "remoteCursor": "3",
        },
        {
          "remoteConnect": "online",
        },
        {
          "remoteRead": "ready",
        },
        {
          "remoteCursor": "4",
        },
        {
          "remoteCursor": "5",
        },
        {
          "remoteConnect": "offline",
          "remoteRead": "offline",
        },
      ]
    `);
    expect(syncStatusDiffs(syncUpdates2)).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        {
          "localRead": "ready",
        },
        {
          "remoteCursor": "1",
        },
        {
          "remoteCursor": "2",
        },
        {
          "remoteCursor": "3",
        },
        {
          "remoteConnect": "connecting",
        },
        {
          "remoteConnect": "online",
        },
        {
          "remoteRead": "ready",
        },
        {
          "localSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "pending",
        },
        {
          "remoteSave": "saving",
        },
        {
          "remoteSave": "ready",
        },
        {
          "localSave": "ready",
        },
        {
          "remoteConnect": "offline",
          "remoteRead": "offline",
        },
      ]
    `);
    expect(client1ListSub.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "subscribe",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "userId": "b",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "userId": "b",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "iOywLlrW",
              "userId": "b",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "userId": "b",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "self": true,
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
      ]
    `);
    expect(client2ListSub.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
          ],
          {
            "origin": "subscribe",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "Zob0dMmD",
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "leySPlIR",
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "remote",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "iOywLlrW",
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "iOywLlrW",
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "a",
              "presence": undefined,
              "ref": "x_n2sT7P",
              "userId": "a",
            },
          ],
          {
            "origin": "self",
          },
        ],
        [
          [
            {
              "clientId": "b",
              "presence": undefined,
              "ref": "ZLVXz73q",
              "self": true,
              "userId": "b",
            },
          ],
          {
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
      {
        "a:client1": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      {
        "b:client2": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      {
        "b:client3": undefined,
      }
    `);

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);

    client1.updatePresence('presence 1');
    client2.updatePresence('presence 2');
    client3.updatePresence('presence 3');

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
  });
});
