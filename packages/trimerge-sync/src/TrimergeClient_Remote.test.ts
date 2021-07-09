import { computeRef, diff, merge, patch } from './testLib/MergeUtils';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { SyncStatus } from './types';
import { timeout } from './lib/Timeout';
import { resetAll, setChannelsPaused } from './testLib/MemoryBroadcastChannel';

type TestEditMetadata = string;
type TestState = any;
type TestPresenceState = any;

const differ: Differ<TestState, TestEditMetadata, TestPresenceState> = {
  diff,
  patch,
  computeRef,
  merge,
};

const stores = new Set<
  MemoryStore<TestEditMetadata, Delta, TestPresenceState>
>();

afterEach(async () => {
  for (const store of stores) {
    await store.shutdown();
  }
  stores.clear();
  resetAll();
});

function newStore(
  remote?: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
) {
  const store = new MemoryStore<TestEditMetadata, Delta, TestPresenceState>(
    undefined,
    remote?.getRemote,
  );
  stores.add(store);
  return store;
}

function makeClient(
  userId: string,
  clientId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestPresenceState> {
  return new TrimergeClient(userId, clientId, store.getLocalStore, differ, 0);
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
  client1: TrimergeClient<
    TestState,
    TestEditMetadata,
    Delta,
    TestPresenceState
  >,
) {
  return getBasicGraph(
    store.getNodes(),
    (node) => node.editMetadata,
    (node) => client1.getNodeState(node.ref).value,
  );
}

function basicClients(
  client1: TrimergeClient<
    TestState,
    TestEditMetadata,
    Delta,
    TestPresenceState
  >,
): Record<string, TestPresenceState> {
  const obj: Record<string, TestPresenceState> = {};
  for (const client of client1.clients) {
    obj[`${client.userId}:${client.clientId}`] = client.state;
  }
  return obj;
}

describe('Remote sync', () => {
  it('syncs one client to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    client.updateState({}, 'initialize');
    client.updateState({ hello: 'world' }, 'add hello');

    await timeout();

    const localGraph1 = basicGraph(localStore, client);
    const remoteGraph1 = basicGraph(remoteStore, client);
    expect(remoteGraph1).toEqual(localGraph1);
    expect(localGraph1).toMatchInlineSnapshot(`
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
      ]
    `);
    expect(syncUpdates).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
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
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
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

  it('syncs two clients to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);

    const syncUpdates1: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));

    client1.updateState({}, 'initialize');
    client1.updateState({ hello: 'world' }, 'add hello');

    await timeout();

    const client2 = makeClient('test', 'b', localStore);

    const syncUpdates2: SyncStatus[] = [];
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));

    await timeout();

    expect(syncUpdates1).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
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
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
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
    expect(syncUpdates2).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
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

  it('syncs two clients to remote with a local split', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client1 = makeClient('test', 'a', localStore);
    const client2 = makeClient('test', 'b', localStore);

    const states1: TestState[] = [];
    client1.subscribeState((state) => states1.push(state));
    const states2: TestState[] = [];
    client2.subscribeState((state) => states2.push(state));

    client1.updateState({}, 'initialize');
    client1.updateState({ hello: 'world' }, 'add hello');

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
        Object {
          "hello": "world",
        },
      ]
    `);

    setChannelsPaused(true);

    await timeout();

    client2.updateState({ hello: 'world', world: 'hello' }, 'add world');

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
        },
        Object {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);

    setChannelsPaused(false);

    await timeout(100);

    expect(states1).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {},
        Object {
          "hello": "world",
        },
        Object {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);
    expect(states2).toMatchInlineSnapshot(`
      Array [
        undefined,
        Object {
          "hello": "world",
        },
        Object {
          "hello": "world",
          "world": "hello",
        },
      ]
    `);
  });

  it('syncs one clients to a store multiple times', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', 'test', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates.push(state));

    client.updateState({}, 'initialize');
    client.updateState({ hello: 'world' }, 'add hello');

    await timeout();

    // Kill the "connection"
    remoteStore.remotes[0].fail('testing', 'network');

    client.updateState({ hello: 'vorld' }, 'change hello');
    client.updateState({ hello: 'borld' }, 'change hello');

    const localGraph2 = basicGraph(localStore, client);
    const remoteGraph2 = basicGraph(remoteStore, client);
    expect(remoteGraph2).toEqual(localGraph2);

    // Need to wait longer for the "reconnect"
    await timeout(10);

    const localGraph3 = basicGraph(localStore, client);
    const remoteGraph3 = basicGraph(remoteStore, client);
    expect(remoteGraph3).toEqual(localGraph3);

    expect(syncUpdates).toMatchInlineSnapshot(`
      Array [
        Object {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
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
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
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
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "saving",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
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
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "pending",
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
      ]
    `);
  });

  it('syncs two clients to a store', async () => {
    const remoteStore = newStore();
    const store1 = newStore(remoteStore);
    const store2 = newStore(remoteStore);
    const client1 = makeClient('a', 'test', store1);
    const client2 = makeClient('b', 'test', store2);

    const syncUpdates1: SyncStatus[] = [];
    const syncUpdates2: SyncStatus[] = [];
    client1.subscribeSyncStatus((state) => syncUpdates1.push(state));
    client2.subscribeSyncStatus((state) => syncUpdates2.push(state));

    client1.updateState({}, 'initialize');
    client1.updateState({ hello: 'world' }, 'add hello');
    client1.updateState({ hello: 'vorld' }, 'change hello');

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual(undefined);

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    client2.updateState({ hello: 'vorld', world: 'world' }, 'add world');
    client2.updateState({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    const graph1 = basicGraph(store1, client1);
    const graph2 = basicGraph(store2, client1);
    expect(graph1).toMatchInlineSnapshot(`
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
          "graph": "YYUSBDXS -> YFIigfVr",
          "step": "User b: add world",
          "value": Object {
            "hello": "vorld",
            "world": "world",
          },
        },
        Object {
          "graph": "YFIigfVr -> 3duBmH5E",
          "step": "User b: change world",
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
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "connecting",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "loading",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "saving",
        },
        Object {
          "localRead": "ready",
          "localSave": "pending",
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
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
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
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
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
          "remoteConnect": "connecting",
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
          "localSave": "pending",
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
          "localSave": "ready",
          "remoteConnect": "online",
          "remoteRead": "ready",
          "remoteSave": "pending",
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
        Object {
          "localRead": "ready",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
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
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      Object {
        "a:client1": undefined,
        "b:client2": undefined,
        "b:client3": undefined,
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      Object {
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
      Object {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
    expect(basicClients(client2)).toMatchInlineSnapshot(`
      Object {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
    expect(basicClients(client3)).toMatchInlineSnapshot(`
      Object {
        "a:client1": "presence 1",
        "b:client2": "presence 2",
        "b:client3": "presence 3",
      }
    `);
  });
});
