import { computeRef, diff, merge, patch, timeout } from './testLib/MergeUtils';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { SyncStatus } from './types';

type TestEditMetadata = string;
type TestState = any;
type TestCursorState = any;

const differ: Differ<TestState, TestEditMetadata, TestCursorState> = {
  diff,
  patch,
  computeRef,
  merge,
};

function newStore(
  remote?: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
) {
  return new MemoryStore<TestEditMetadata, Delta, TestCursorState>(
    undefined,
    remote?.getRemoteBackendFn,
  );
}

function makeClient(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestCursorState>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestCursorState> {
  return new TrimergeClient(userId, 'test', store.getLocalBackend, differ, 0);
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

describe('Remote sync', () => {
  it('syncs one clients to a remote', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncState((state) => syncUpdates.push(state));

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
          "localRead": "loading",
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

  it('syncs one clients to a store multiple times', async () => {
    const remoteStore = newStore();
    const localStore = newStore(remoteStore);
    const client = makeClient('a', localStore);

    const syncUpdates: SyncStatus[] = [];
    client.subscribeSyncState((state) => syncUpdates.push(state));

    client.updateState({}, 'initialize');
    client.updateState({ hello: 'world' }, 'add hello');

    await timeout();

    // Kill the "connection"
    remoteStore.remoteBackends[0].fail('testing', 'network');

    client.updateState({ hello: 'vorld' }, 'change hello');
    client.updateState({ hello: 'borld' }, 'change hello');

    const localGraph2 = basicGraph(localStore, client);
    const remoteGraph2 = basicGraph(remoteStore, client);
    expect(remoteGraph2).toEqual(localGraph2);

    await timeout();

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
          "localRead": "loading",
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

  it('syncs two clients to a store', async () => {
    const remoteStore = newStore();
    const store1 = newStore(remoteStore);
    const store2 = newStore(remoteStore);
    const client1 = makeClient('a', store1);
    const client2 = makeClient('b', store2);

    const syncUpdates1: SyncStatus[] = [];
    const syncUpdates2: SyncStatus[] = [];
    client1.subscribeSyncState((state) => syncUpdates1.push(state));
    client2.subscribeSyncState((state) => syncUpdates2.push(state));

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
          "localRead": "loading",
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
          "remoteRead": "offline",
          "remoteSave": "ready",
        },
        Object {
          "localRead": "loading",
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
  });
});
