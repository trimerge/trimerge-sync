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
import { MemoryLogger } from './testLib/MemoryLogger';
import { MemoryRemote, MemoryServer } from './testLib/MemoryRemote';

type TestMetadata = string;

const stores = new Set<MemoryStore<TestMetadata, Delta, TestPresence>>();

afterEach(async () => {
  for (const store of stores) {
    await store.shutdown();
  }
  stores.clear();
  resetAll();
});

/** A server is a thin wrapper around a store that represents the entity that
 *  the memory remote is connecting to. A server allows you to create multiple remotes
 *  by supplying clientInfo.
 */
function newServer() {
  const store = new MemoryStore<TestMetadata, Delta, TestPresence>(undefined);
  stores.add(store);
  return new MemoryServer(store);
}

function newStore() {
  const store = new MemoryStore<TestMetadata, Delta, TestPresence>(undefined);
  stores.add(store);
  return store;
}

/** This function accepts clientInfo, a MemoryStore and a MemoryServer and creates a
 *  TrimergeClient that uses the MemoryStore as its local store and connects to the
 *  MemoryServer via a MemoryRemote.
 */
function makeClient(
  { userId, clientId }: { userId: string; clientId: string },
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
  server: MemoryServer<TestMetadata, Delta, TestPresence>,
  logger: MemoryLogger = new MemoryLogger(),
): {
  client: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestMetadata,
    Delta,
    TestPresence
  >;
  remote: MemoryRemote<TestMetadata, Delta, TestPresence>;
  logger: MemoryLogger;
} {
  const remote = server.remote({ userId, clientId });
  const client = new TrimergeClient(userId, clientId, {
    ...TEST_OPTS,
    localStore: store.getLocalStore({ userId, clientId }, remote),
  });

  client.configureLogger(logger);
  return { client, remote, logger };
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

describe('Remote sync', () => {
  it('syncs one client to a remote', async () => {
    const server = newServer();
    const localStore = newStore();
    const { client, remote } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClient',
      },
      localStore,
      server,
    );

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    // wait for the remote to connect
    await remote.onConnected();

    await client.updateDoc({}, 'initialize');
    await client.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(server.store, client);
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
                "localRead": "ready",
              },
              {
                "remoteConnect": "connecting",
              },
              {
                "localSave": "saving",
              },
              {
                "remoteSave": "pending",
              },
              {
                "remoteConnect": "online",
              },
              {
                "remoteConnect": "connecting",
                "remoteSave": "saving",
              },
              {
                "remoteConnect": "online",
              },
              {
                "localSave": "ready",
              },
              {
                "localSave": "saving",
              },
              {
                "remoteSave": "pending",
              },
              {
                "remoteRead": "ready",
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
                "remoteCursor": "1",
              },
              {
                "remoteCursor": "2",
              },
            ]
        `);
  });
  it('handles shutdown while connecting', async () => {
    const { client } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClient',
      },
      newStore(),
      newServer(),
    );
    await timeout();
    await client.shutdown();
  });

  it('syncs local pending changes in batches', async () => {
    const server = newServer();
    const localStore = newStore();
    const { client, remote } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClient',
      },
      localStore,
      server,
    );
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

    remote.online = true;

    // Wait for reconnect
    await timeout(50);

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(server.store, client);
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

  it('syncs two clients to a remote', async () => {
    const server = newServer();
    const localStore = newStore();
    const { client: client1 } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClientA',
      },
      localStore,
      server,
    );

    const syncUpdates1: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));
    const client1Sub = jest.fn();
    client1.subscribeClientList(client1Sub);

    void client1.updateDoc({}, 'initialize');
    void client1.updateDoc({ hello: 'world' }, 'add hello');

    await timeout();

    const { client: client2 } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClientB',
      },
      localStore,
      server,
    );

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
                "localSave": "ready",
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
                "remoteSave": "ready",
              },
              {
                "remoteCursor": "2",
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
                "remoteConnect": "online",
                "remoteCursor": "2",
                "remoteRead": "ready",
              },
            ]
        `);
    expect(client1Sub.mock.calls).toMatchInlineSnapshot(`
            [
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": undefined,
                    "self": true,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "subscribe",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "Zob0dMmD",
                    "self": true,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "self",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "Zob0dMmD",
                    "self": true,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "self",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "self": true,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "self",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "self": true,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "self",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "self": true,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "local",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "self": true,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "self": true,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "local",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
            ]
        `);
    expect(client2Sub.mock.calls).toMatchInlineSnapshot(`
            [
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "self": true,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "subscribe",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "local",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "local",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
              [
                [
                  {
                    "clientId": "testClientB",
                    "presence": undefined,
                    "ref": undefined,
                    "userId": "testUser",
                  },
                  {
                    "clientId": "testClientA",
                    "presence": undefined,
                    "ref": "leySPlIR",
                    "userId": "testUser",
                  },
                ],
                {
                  "origin": "remote",
                },
              ],
            ]
        `);
  });

  it('syncs two clients to remote with a local split', async () => {
    const server = newServer();
    const localStore = newStore();
    const { client: client1 } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClientA',
      },
      localStore,
      server,
    );
    const { client: client2 } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClientB',
      },
      localStore,
      server,
    );

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

  it('syncs one client to a store multiple times', async () => {
    const server = newServer();
    const localStore = newStore();
    const { client, remote } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClient',
      },
      localStore,
      server,
    );

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    await client.updateDoc({}, 'initialize');
    await client.updateDoc({ hello: 'world' }, 'add hello');

    await remote.onConnected();
    await timeout();

    const localGraph2 = basicGraph(localStore, client);
    const remoteGraph2 = basicGraph(server.store, client);
    expect(remoteGraph2).toEqual(localGraph2);

    // Kill the "connection"
    remote.fail('testing', 'network');

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

    const remoteGraph3 = basicGraph(server.store, client);
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
                "localSave": "ready",
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
                "localSave": "ready",
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
                "remoteSave": "ready",
              },
              {
                "remoteCursor": "2",
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
                "localSave": "ready",
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
                "remoteSave": "ready",
              },
              {
                "remoteCursor": "4",
              },
            ]
        `);
  });

  it('handles leader network split', async () => {
    const server = newServer();
    const localStore = newStore();

    const { client: client1 } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClientA',
      },
      localStore,
      server,
    );
    const { client: client2 } = makeClient(
      {
        userId: 'testUser',
        clientId: 'testClientB',
      },
      localStore,
      server,
    );

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
              "remoteCursor": undefined,
              "remoteRead": "ready",
              "remoteSave": "ready",
            }
        `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
            {
              "localRead": "ready",
              "localSave": "ready",
              "remoteConnect": "online",
              "remoteCursor": undefined,
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
              "remoteCursor": undefined,
              "remoteRead": "ready",
              "remoteSave": "ready",
            }
        `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
            {
              "localRead": "ready",
              "localSave": "ready",
              "remoteConnect": "online",
              "remoteCursor": undefined,
              "remoteRead": "ready",
              "remoteSave": "ready",
            }
        `);
  });

  it('syncs two client stores to a remote store', async () => {
    const server = newServer();
    const localStore1 = newStore();
    const localStore2 = newStore();
    const { client: client1 } = makeClient(
      {
        userId: 'testUserA',
        clientId: 'testClientA',
      },
      localStore1,
      server,
    );
    const { client: client2 } = makeClient(
      {
        userId: 'testUserB',
        clientId: 'testClientB',
      },
      localStore2,
      server,
    );

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

    const graph1 = basicGraph(localStore1, client1);
    const graph2 = basicGraph(localStore2, client1);
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
                "remoteSave": "pending",
              },
              {
                "remoteSave": "saving",
              },
              {
                "localSave": "ready",
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
                "remoteSave": "ready",
              },
              {
                "remoteCursor": "3",
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
    expect(client1ListSub.mock.calls).toMatchSnapshot();
    expect(client2ListSub.mock.calls).toMatchSnapshot();
  });

  it('syncs three clients with two local stores', async () => {
    const server = newServer();
    const localStore1 = newStore();
    const { client: client1 } = makeClient(
      { userId: 'testUserA', clientId: 'testClientA' },
      localStore1,
      server,
    );

    const localStore2 = newStore();
    const { client: client2 } = makeClient(
      { userId: 'testUserB', clientId: 'testClientB1' },
      localStore2,
      server,
    );
    const { client: client3 } = makeClient(
      { userId: 'testUserB', clientId: 'testClientB2' },
      localStore2,
      server,
    );

    expect(basicClients(client1)).toMatchInlineSnapshot(`
            {
              "testUserA:testClientA": undefined,
            }
        `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
            {
              "testUserB:testClientB1": undefined,
            }
        `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
            {
              "testUserB:testClientB2": undefined,
            }
        `);

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
      {
        "testUserA:testClientA": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      {
        "testUserB:testClientB1": undefined,
        "testUserB:testClientB2": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      {
        "testUserB:testClientB1": undefined,
        "testUserB:testClientB2": undefined,
      }
    `);

    client1.updatePresence('presence 1');
    client2.updatePresence('presence 2');
    client3.updatePresence('presence 3');

    await timeout();

    expect(basicClients(client1)).toMatchInlineSnapshot(`
            {
              "testUserA:testClientA": "presence 1",
              "testUserB:testClientB1": "presence 2",
              "testUserB:testClientB2": "presence 3",
            }
        `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
            {
              "testUserA:testClientA": "presence 1",
              "testUserB:testClientB1": "presence 2",
              "testUserB:testClientB2": "presence 3",
            }
        `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
            {
              "testUserA:testClientA": "presence 1",
              "testUserB:testClientB1": "presence 2",
              "testUserB:testClientB2": "presence 3",
            }
        `);
  });
});
