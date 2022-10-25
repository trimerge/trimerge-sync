import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { TrimergeClientOptions } from './TrimergeClientOptions';
import { MemoryStore } from './testLib/MemoryStore';
import {
  computeRef,
  diff,
  mergeAllBranches,
  patch,
} from './testLib/MergeUtils';
import { getBasicGraph } from './lib/GraphVisualizers';
import { ClientInfo } from './types';
import { timeout } from './lib/Timeout';

type TestMetadata = {
  message: string;
};
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const opts: Pick<
  TrimergeClientOptions<TestSavedDoc, TestDoc, TestMetadata, any, TestPresence>,
  'differ' | 'computeRef' | 'mergeAllBranches'
> = {
  differ: {
    diff,
    patch,
  },
  computeRef,
  mergeAllBranches,
};

function newStore() {
  return new MemoryStore<TestMetadata, Delta, TestPresence>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<TestSavedDoc, TestDoc, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', {
    ...opts,
    getLocalStore: store.getLocalStore,
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
    (commit) => commit.metadata.message,
    (commit) => client1.getCommitDoc(commit.ref).doc,
  );
}

function sortedClients(
  client: TrimergeClient<
    TestSavedDoc,
    TestDoc,
    TestMetadata,
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

    void client.updateDoc({}, { message: 'initialize' });
    void client.updateDoc({ hello: 'world' }, { message: 'add hello' });
    void client.updateDoc({ hello: 'vorld' }, { message: 'change hello' });

    expect(client.doc).toEqual({ hello: 'vorld' });

    await timeout();

    expect(basicGraph(store, client)).toMatchInlineSnapshot(`
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
      ]
    `);
  });

  it('tracks non-edits', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    const onStateChange = jest.fn();
    const unsub = client.subscribeDoc(onStateChange);
    void client.updateDoc(undefined, { message: 'initialize' });
    await timeout();
    void client.updateDoc(undefined, { message: 'initialize' });
    await timeout();

    expect(onStateChange.mock.calls).toMatchInlineSnapshot(`
      [
        [
          undefined,
          {
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
    client.updatePresence({ message: 'blah' });
    await timeout();

    expect(onStateChange.mock.calls.slice(-1)).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "clientId": "test",
              "presence": {
                "message": "blah",
              },
              "ref": undefined,
              "self": true,
              "userId": "a",
            },
          ],
          {
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

    // clear any client join state.
    await timeout();

    // No values
    expect(client1.doc).toBe(undefined);
    expect(client2.doc).toBe(undefined);

    const writePromise = client1.updateDoc({}, { message: 'initialize' });

    // Client 1 is updated, but not client2
    expect(client1.doc).toEqual({});
    expect(client2.doc).toBe(undefined);

    await writePromise;

    // Client2 is updated now
    expect(client1.doc).toEqual({});
    expect(client2.doc).toEqual({});

    expect(client1.syncStatus).toMatchInlineSnapshot(`
      {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "offline",
        "remoteRead": "offline",
        "remoteSave": "saving",
      }
    `);

    expect(client2.syncStatus).toMatchInlineSnapshot(`
      {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "offline",
        "remoteRead": "offline",
        "remoteSave": "saving",
      }
    `);
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
      [
        {
          "clientId": "test",
          "presence": undefined,
          "ref": undefined,
          "self": true,
          "userId": "a",
        },
        {
          "clientId": "test",
          "presence": undefined,
          "ref": undefined,
          "userId": "b",
        },
      ]
    `);
    expect(sortedClients(client2)).toMatchInlineSnapshot(`
      [
        {
          "clientId": "test",
          "presence": undefined,
          "ref": undefined,
          "userId": "a",
        },
        {
          "clientId": "test",
          "presence": undefined,
          "ref": undefined,
          "self": true,
          "userId": "b",
        },
      ]
    `);

    expect(client1Sub.mock.calls).toMatchInlineSnapshot(`
      [
        [
          [
            {
              "clientId": "test",
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
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "a",
            },
            {
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "userId": "b",
            },
          ],
          {
            "origin": "local",
          },
        ],
        [
          [
            {
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "a",
            },
            {
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "userId": "b",
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
              "clientId": "test",
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
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "userId": "a",
            },
          ],
          {
            "origin": "local",
          },
        ],
        [
          [
            {
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "self": true,
              "userId": "b",
            },
            {
              "clientId": "test",
              "presence": undefined,
              "ref": undefined,
              "userId": "a",
            },
          ],
          {
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

    void client1.updateDoc({}, { message: 'initialize' });
    void client1.updateDoc({ edit: true }, { message: 'edit' });

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

    void client1.updateDoc({}, { message: 'initialize' });
    void client1.updateDoc({ hello: 'world' }, { message: 'add hello' });
    void client1.updateDoc({ hello: 'vorld' }, { message: 'change hello' });

    await timeout();

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual({ hello: 'vorld' });

    void client2.updateDoc(
      { hello: 'vorld', world: 'world' },
      { message: 'add world' },
    );
    void client2.updateDoc(
      { hello: 'vorld', world: 'vorld' },
      { message: 'change world' },
    );

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

    void client1.updateDoc({}, { message: 'initialize' });

    // Synchronized
    expect(client1.doc).toEqual({});
    expect(client2.doc).toEqual(undefined);

    await timeout();

    expect(client2.doc).toEqual({});

    void client1.updateDoc({ hello: 'world' }, { message: 'add hello' });
    void client1.updateDoc({ hello: 'vorld' }, { message: 'change hello' });

    void client2.updateDoc({ world: 'world' }, { message: 'add world' });
    void client2.updateDoc({ world: 'vorld' }, { message: 'change world' });

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
          "graph": "Zob0dMmD -> JQGldkEn",
          "step": "add world",
          "value": {
            "world": "world",
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
          "graph": "JQGldkEn -> ImI6Nmiz",
          "step": "change world",
          "value": {
            "world": "vorld",
          },
        },
      ]
    `);
  });

  it('sync up when second client comes in later', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    void client1.updateDoc({}, { message: 'initialize' });
    void client1.updateDoc({ hello: 'world' }, { message: 'add hello' });
    void client1.updateDoc({ hello: 'vorld' }, { message: 'change hello' });

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);
    await timeout();
    expect(client2.doc).toEqual({ hello: 'vorld' });

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
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
      ]
    `);
  });

  it('subscription works', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const subscribeFn = jest.fn();

    const unsubscribeFn = client1.subscribeDoc(subscribeFn);

    void client1.updateDoc({}, { message: 'initialize' });
    void client1.updateDoc({ hello: 'world' }, { message: 'add hello' });
    void client1.updateDoc({ hello: 'vorld' }, { message: 'change hello' });

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.doc).toEqual({ hello: 'vorld' });
    expect(client2.doc).toEqual(undefined);

    await timeout();

    void client1.updateDoc(
      { hello: 'there' },
      { message: 'change hello again' },
    );

    await timeout();

    unsubscribeFn();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
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
          "graph": "x_n2sT7P -> 38Fdqmoz",
          "step": "change hello again",
          "value": {
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

    void client1.updateDoc({}, { message: 'initialize' });
    void client1.updateDoc({ hello: 'world' }, { message: 'add hello' });
    void client1.updateDoc({ hello: 'world. t' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. th' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. thi' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. this' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. this ' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. this i' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. this is' }, { message: 'typing' });
    void client1.updateDoc({ hello: 'world. this is ' }, { message: 'typing' });
    void client1.updateDoc(
      { hello: 'world. this is a' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a t' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a te' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a tes' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test ' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test o' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of ' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of c' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of ch' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of cha' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of char' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of chara' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of charac' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of charact' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of characte' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of character' },
      { message: 'typing' },
    );
    void client1.updateDoc(
      { hello: 'world. this is a test of character.' },
      { message: 'typing' },
    );

    await timeout();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
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
          "graph": "leySPlIR -> YAy0M_J2",
          "step": "typing",
          "value": {
            "hello": "world. t",
          },
        },
        {
          "graph": "YAy0M_J2 -> LsIxqujJ",
          "step": "typing",
          "value": {
            "hello": "world. th",
          },
        },
        {
          "graph": "LsIxqujJ -> yoPegGx6",
          "step": "typing",
          "value": {
            "hello": "world. thi",
          },
        },
        {
          "graph": "yoPegGx6 -> eTLOHYa-",
          "step": "typing",
          "value": {
            "hello": "world. this",
          },
        },
        {
          "graph": "eTLOHYa- -> WDzPFBwe",
          "step": "typing",
          "value": {
            "hello": "world. this ",
          },
        },
        {
          "graph": "WDzPFBwe -> YoyNjiZ6",
          "step": "typing",
          "value": {
            "hello": "world. this i",
          },
        },
        {
          "graph": "YoyNjiZ6 -> rOUBm7c2",
          "step": "typing",
          "value": {
            "hello": "world. this is",
          },
        },
        {
          "graph": "rOUBm7c2 -> MsplY0xo",
          "step": "typing",
          "value": {
            "hello": "world. this is ",
          },
        },
        {
          "graph": "MsplY0xo -> JnbUEhpb",
          "step": "typing",
          "value": {
            "hello": "world. this is a",
          },
        },
        {
          "graph": "JnbUEhpb -> POK9sZXI",
          "step": "typing",
          "value": {
            "hello": "world. this is a t",
          },
        },
        {
          "graph": "POK9sZXI -> yEO3XYgv",
          "step": "typing",
          "value": {
            "hello": "world. this is a te",
          },
        },
        {
          "graph": "yEO3XYgv -> VIhrAVTG",
          "step": "typing",
          "value": {
            "hello": "world. this is a tes",
          },
        },
        {
          "graph": "VIhrAVTG -> 9HSyQTMd",
          "step": "typing",
          "value": {
            "hello": "world. this is a test",
          },
        },
        {
          "graph": "9HSyQTMd -> xGjtRo_F",
          "step": "typing",
          "value": {
            "hello": "world. this is a test ",
          },
        },
        {
          "graph": "xGjtRo_F -> GFUqLq42",
          "step": "typing",
          "value": {
            "hello": "world. this is a test o",
          },
        },
        {
          "graph": "GFUqLq42 -> 8Zpd5VpF",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of",
          },
        },
        {
          "graph": "8Zpd5VpF -> 0JCZFqxq",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of ",
          },
        },
        {
          "graph": "0JCZFqxq -> 5Y4GtM8z",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of c",
          },
        },
        {
          "graph": "5Y4GtM8z -> W-adW2a-",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of ch",
          },
        },
        {
          "graph": "W-adW2a- -> 1nf6gXl1",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of cha",
          },
        },
        {
          "graph": "1nf6gXl1 -> xF9W97WS",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of char",
          },
        },
        {
          "graph": "xF9W97WS -> E8TIq05x",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of chara",
          },
        },
        {
          "graph": "E8TIq05x -> 3hCls5tY",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of charac",
          },
        },
        {
          "graph": "3hCls5tY -> Hl2TeGle",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of charact",
          },
        },
        {
          "graph": "Hl2TeGle -> NXbxkJK2",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of characte",
          },
        },
        {
          "graph": "NXbxkJK2 -> Uc41cdXS",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of character",
          },
        },
        {
          "graph": "Uc41cdXS -> QNhbrQRR",
          "step": "typing",
          "value": {
            "hello": "world. this is a test of character.",
          },
        },
      ]
    `);
  });

  it('does not generate a new commit if docs are deep equal but not reference equal', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    await client.updateDoc(
      {
        foo: 'bar',
      },
      { message: 'message' },
    );

    await client.updateDoc(
      {
        foo: 'bar',
      },
      { message: 'message' },
    );

    const commits = store.getCommits();
    expect(commits).toMatchInlineSnapshot(`
      [
        {
          "baseRef": undefined,
          "delta": [
            {
              "foo": "bar",
            },
          ],
          "metadata": {
            "message": "message",
          },
          "ref": "0OUcxXho",
        },
      ]
    `);
  });

  it('it still generates merge commits even when deltas are noop', async () => {
    const store = newStore();
    const clientA = makeClient('a', store);
    const clientB = makeClient('a', store);

    // These docs were explicitly chosen to have refs such that the
    // first doc is sorted as the base ref when they're merged.
    void clientA.updateDoc(
      { hi: 'world', other: 'world' },
      { message: 'blah' },
    );
    void clientB.updateDoc({ hi: 'world' }, { message: 'blah' });

    expect(clientA.doc).toEqual({ hi: 'world', other: 'world' });
    expect(clientB.doc).toEqual({ hi: 'world' });

    await timeout();

    expect(clientA.doc).toEqual({ hi: 'world', other: 'world' });
    expect(clientB.doc).toEqual({ hi: 'world', other: 'world' });

    // final update to finalize the merge commit
    await clientA.updateDoc(
      { hi: 'world', other: 'worldly' },
      { message: 'blah' },
    );

    expect(store.getCommits()).toMatchInlineSnapshot(`
      [
        {
          "baseRef": undefined,
          "delta": [
            {
              "hi": "world",
              "other": "world",
            },
          ],
          "metadata": {
            "message": "blah",
          },
          "ref": "83C7ugjw",
        },
        {
          "baseRef": undefined,
          "delta": [
            {
              "hi": "world",
            },
          ],
          "metadata": {
            "message": "blah",
          },
          "ref": "guqurHSi",
        },
        {
          "baseRef": "83C7ugjw",
          "delta": undefined,
          "mergeRef": "guqurHSi",
          "metadata": {
            "message": "merge",
            "ref": "(83C7ugjw+guqurHSi)",
          },
          "ref": "jBSIed8b",
        },
        {
          "baseRef": "jBSIed8b",
          "delta": {
            "other": [
              "world",
              "worldly",
            ],
          },
          "metadata": {
            "message": "blah",
          },
          "ref": "FM-iAbj3",
        },
      ]
    `);
  });
});
