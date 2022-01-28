import 'fake-indexeddb/auto';

import type { Commit, GetRemoteFn } from 'trimerge-sync';
import { TrimergeClient } from 'trimerge-sync';
import {
  AddStoreMetadataFn,
  createIndexedDbBackendFactory,
  deleteDocDatabase,
  resetDocRemoteSyncData,
} from './trimerge-indexed-db';
import { differ } from './testLib/BasicDiffer';
import { timeout } from './lib/timeout';
import { getMockRemote, getMockRemoteWithMap } from './testLib/MockRemote';
import { dumpDatabase, getIdbDatabases } from './testLib/IndexedDB';

function makeTestClient(
  userId: string,
  clientId: string,
  docId: string,
  storeId: string,
  getRemote?: GetRemoteFn<any, any, any>,
  addStoreMetadata?: AddStoreMetadataFn<any>,
) {
  return new TrimergeClient(
    userId,
    clientId,
    createIndexedDbBackendFactory(docId, {
      localIdGenerator: () => storeId,
      getRemote,
      networkSettings: {
        initialDelayMs: 0,
        reconnectBackoffMultiplier: 1,
        maxReconnectDelayMs: 0,
        electionTimeoutMs: 0,
        heartbeatIntervalMs: 10,
        heartbeatTimeoutMs: 50,
      },
      addStoreMetadata,
    }),
    differ,
  );
}

beforeEach(() => {
  // override readonly status
  global.indexedDB! = new IDBFactory();
});

describe('createIndexedDbBackendFactory', () => {
  it('creates indexed db', async () => {
    const docId = 'test-doc-create';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateDoc('hello', '');
    client.updateDoc('hello there', '');

    // Wait for write
    await timeout(100);
    await client.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello",
                  ],
                  "metadata": "",
                  "ref": "G0a5Az3Q",
                  "remoteSyncId": "",
                  "syncId": 1,
                },
                Object {
                  "baseRef": "G0a5Az3Q",
                  "delta": Array [
                    "hello",
                    "hello there",
                  ],
                  "metadata": "",
                  "ref": "HwWFgzWO",
                  "remoteSyncId": "",
                  "syncId": 2,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "HwWFgzWO",
                },
              ],
              "remotes": Array [
                Object {
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('creates indexed db and can read it', async () => {
    const docId = 'test-doc-read';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateDoc('hello', '');
    client.updateDoc('hello there', '');
    client.updateDoc('hello world', '');
    // Wait for write
    await timeout(100);
    await client.shutdown();

    // Wait for idb to settle down
    await timeout(100);

    const client2 = makeTestClient('test', '2', docId, 'test-doc-store');

    // Wait for read
    await timeout(100);
    expect(client2.doc).toEqual('hello world');

    await client2.shutdown();
  });

  it('collaboration works', async () => {
    const docId = 'test-doc-collab';
    const client1 = makeTestClient('test', '1', docId, 'test-doc-store');
    client1.updateDoc('hello', '');
    client1.updateDoc('hello world', '');
    // Wait for write
    await timeout(100);

    const client2 = makeTestClient('test', '2', docId, 'test-doc-store');

    // Wait for read
    await timeout(100);
    expect(client2.doc).toEqual('hello world');

    client1.updateDoc('hello there', '');
    await timeout();
    client2.updateDoc('oh hello', '');

    // Wait for read
    await timeout(100);
    expect(client1.doc).toEqual('oh hello there');
    expect(client2.doc).toEqual('oh hello there');

    await client1.shutdown();
    await client2.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello",
                  ],
                  "metadata": "",
                  "ref": "G0a5Az3Q",
                  "remoteSyncId": "",
                  "syncId": 1,
                },
                Object {
                  "baseRef": "G0a5Az3Q",
                  "delta": Array [
                    "hello",
                    "hello world",
                  ],
                  "metadata": "",
                  "ref": "VXV5D7z7",
                  "remoteSyncId": "",
                  "syncId": 2,
                },
                Object {
                  "baseRef": "VXV5D7z7",
                  "delta": Array [
                    "hello world",
                    "hello there",
                  ],
                  "metadata": "",
                  "ref": "YFy1LPs2",
                  "remoteSyncId": "",
                  "syncId": 3,
                },
                Object {
                  "baseRef": "VXV5D7z7",
                  "delta": Array [
                    "hello world",
                    "oh hello",
                  ],
                  "metadata": "",
                  "ref": "aG60Gm4o",
                  "remoteSyncId": "",
                  "syncId": 4,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "YFy1LPs2",
                },
                Object {
                  "ref": "aG60Gm4o",
                },
              ],
              "remotes": Array [
                Object {
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('adds metadata via addStoreMetadata', async () => {
    const docId = 'test-doc-collab';
    const addStoreMetadata: AddStoreMetadataFn<any> = (
      commit,
      localStoreId,
      commitIndex,
    ) => {
      return {
        ...commit.metadata,
        clientStore: { localStoreId, commitIndex },
        hello: 'world',
      };
    };
    const client1 = makeTestClient(
      'test',
      '1',
      docId,
      'test-doc-store',
      undefined,
      addStoreMetadata,
    );
    client1.updateDoc('hello', '');
    // Wait for write
    await timeout(100);

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      undefined,
      addStoreMetadata,
    );

    // Wait for read
    await timeout(100);

    client2.updateDoc('hello there', '');

    // Wait for read
    await timeout(100);
    expect(client1.doc).toEqual('hello there');
    expect(client2.doc).toEqual('hello there');

    await client1.shutdown();
    await client2.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello",
                  ],
                  "metadata": Object {
                    "clientStore": Object {
                      "commitIndex": 1,
                      "localStoreId": "test-doc-store",
                    },
                    "hello": "world",
                  },
                  "ref": "G0a5Az3Q",
                  "remoteSyncId": "",
                  "syncId": 1,
                },
                Object {
                  "baseRef": "G0a5Az3Q",
                  "delta": Array [
                    "hello",
                    "hello there",
                  ],
                  "metadata": Object {
                    "clientStore": Object {
                      "commitIndex": 2,
                      "localStoreId": "test-doc-store",
                    },
                    "hello": "world",
                  },
                  "ref": "HwWFgzWO",
                  "remoteSyncId": "",
                  "syncId": 2,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "HwWFgzWO",
                },
              ],
              "remotes": Array [
                Object {
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('deletes indexed db with deleteDocDatabase', async () => {
    const docId = 'test-doc-delete';
    const client1 = makeTestClient('test', '1', docId, 'test-doc-store');
    client1.updateDoc('hello world', '');
    // Wait for write
    await timeout(1000);
    await client1.shutdown();

    await expect(getIdbDatabases()).resolves.toMatchInlineSnapshot(`
                  Array [
                    Object {
                      "name": "trimerge-sync:test-doc-delete",
                      "version": 2,
                    },
                  ]
              `);

    await deleteDocDatabase(docId);

    await expect(getIdbDatabases()).resolves.toHaveLength(0);
  });

  it('works with remote', async () => {
    const docId = 'test-doc-remote';
    const client1 = makeTestClient(
      'test',
      '1',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    client1.updateDoc('hello remote', '');
    // Wait for write
    await timeout(100);
    await client1.shutdown();

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    // Wait for write
    await timeout(100);
    expect(client2.doc).toEqual('hello remote');
    await client2.shutdown();
  });

  it('resets remote data', async () => {
    const docId = 'test-doc-reset-remote';
    const client1 = makeTestClient(
      'test',
      '1',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    client1.updateDoc('hello remote', '');
    // Wait for write
    await timeout(100);
    await client1.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello remote",
                  ],
                  "metadata": "",
                  "ref": "F2C9k7m0",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "F2C9k7m0",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
    await resetDocRemoteSyncData(docId);
    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello remote",
                  ],
                  "metadata": "",
                  "ref": "F2C9k7m0",
                  "remoteSyncId": "",
                  "syncId": 1,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "F2C9k7m0",
                },
              ],
              "remotes": Array [],
            }
          `);

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    // Wait for write
    await timeout(100);
    expect(client2.doc).toEqual('hello remote');
    await client2.shutdown();
    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello remote",
                  ],
                  "metadata": "",
                  "ref": "F2C9k7m0",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "F2C9k7m0",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('works offline then with remote', async () => {
    const docId = 'test-doc-remote2';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateDoc('hello offline remote', '');
    // Wait for write
    await timeout(100);
    await client.shutdown();

    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemote,
    );
    // Wait for write
    await timeout(100);
    expect(client2.doc).toEqual('hello offline remote');

    client2.updateDoc('hello online remote', '');
    await timeout(100);

    await client2.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello offline remote",
                  ],
                  "metadata": "",
                  "ref": "QBwr4r32",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
                Object {
                  "baseRef": "QBwr4r32",
                  "delta": Array [
                    "hello offline remote",
                    "hello online remote",
                  ],
                  "metadata": "",
                  "ref": "YSkdCqy1",
                  "remoteSyncId": "foo",
                  "syncId": 2,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "YSkdCqy1",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('works offline then with remote 2', async () => {
    const docId = 'test-doc-remote2';
    const client = makeTestClient('test', '1', docId, 'test-doc-store');
    client.updateDoc(1, '');
    client.updateDoc(2, '');
    client.updateDoc(3, '');
    client.updateDoc(4, '');
    client.updateDoc(5, '');
    client.updateDoc(6, '');

    // Wait for write
    await timeout(100);
    await client.shutdown();

    const commitMap = new Map<string, Commit<any, any>>();
    const client2 = makeTestClient(
      'test',
      '2',
      docId,
      'test-doc-store',
      getMockRemoteWithMap(commitMap),
    );
    // Wait for write
    await timeout(100);

    expect(client2.doc).toEqual(6);
    expect(client2.syncStatus).toMatchInlineSnapshot(`
      Object {
        "localRead": "ready",
        "localSave": "ready",
        "remoteConnect": "online",
        "remoteRead": "ready",
        "remoteSave": "ready",
      }
    `);

    await client2.shutdown();

    expect(Array.from(commitMap.values())).toMatchInlineSnapshot(`
      Array [
        Object {
          "baseRef": undefined,
          "delta": Array [
            1,
          ],
          "metadata": "",
          "ref": "N5uy2QOO",
          "remoteSyncId": "",
          "syncId": 1,
        },
        Object {
          "baseRef": "N5uy2QOO",
          "delta": Array [
            1,
            2,
          ],
          "metadata": "",
          "ref": "F55ccS6M",
          "remoteSyncId": "",
          "syncId": 2,
        },
        Object {
          "baseRef": "F55ccS6M",
          "delta": Array [
            2,
            3,
          ],
          "metadata": "",
          "ref": "uBHlRZDM",
          "remoteSyncId": "",
          "syncId": 3,
        },
        Object {
          "baseRef": "uBHlRZDM",
          "delta": Array [
            3,
            4,
          ],
          "metadata": "",
          "ref": "CujSo7BT",
          "remoteSyncId": "",
          "syncId": 4,
        },
        Object {
          "baseRef": "CujSo7BT",
          "delta": Array [
            4,
            5,
          ],
          "metadata": "",
          "ref": "bXqUP_u1",
          "remoteSyncId": "",
          "syncId": 5,
        },
        Object {
          "baseRef": "bXqUP_u1",
          "delta": Array [
            5,
            6,
          ],
          "metadata": "",
          "ref": "5mFFausi",
          "remoteSyncId": "",
          "syncId": 6,
        },
      ]
    `);
  });

  it('updates metadata from remote', async () => {
    const docId = 'test-doc-remote2';
    const client = makeTestClient(
      'test',
      '1',
      docId,
      'test-doc-store',
      getMockRemoteWithMap(undefined, (commit) => ({
        newMetadata: { fromRemote: true, ref: commit.ref },
        oldMetadata: commit.metadata,
      })),
    );
    client.updateDoc(1, 'hi');
    client.updateDoc(2, 'there');
    client.updateDoc(3, 'sup?');

    // Wait for write
    await timeout(100);
    await client.shutdown();

    await expect(dumpDatabase(docId)).resolves.toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": "N5uy2QOO",
                  "delta": Array [
                    1,
                    2,
                  ],
                  "metadata": Object {
                    "newMetadata": Object {
                      "fromRemote": true,
                      "ref": "F55ccS6M",
                    },
                    "oldMetadata": "there",
                  },
                  "ref": "F55ccS6M",
                  "remoteSyncId": "foo",
                  "syncId": 2,
                },
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    1,
                  ],
                  "metadata": Object {
                    "newMetadata": Object {
                      "fromRemote": true,
                      "ref": "N5uy2QOO",
                    },
                    "oldMetadata": "hi",
                  },
                  "ref": "N5uy2QOO",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
                Object {
                  "baseRef": "F55ccS6M",
                  "delta": Array [
                    2,
                    3,
                  ],
                  "metadata": Object {
                    "newMetadata": Object {
                      "fromRemote": true,
                      "ref": "uBHlRZDM",
                    },
                    "oldMetadata": "sup?",
                  },
                  "ref": "uBHlRZDM",
                  "remoteSyncId": "foo",
                  "syncId": 3,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "uBHlRZDM",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('updates metadata from remote with two users', async () => {
    const mockRemote = getMockRemoteWithMap(new Map(), (commit) => ({
      newMetadata: { fromRemote: 1, ref: commit.ref },
      oldMetadata: commit.metadata,
    }));
    const client1 = makeTestClient(
      'test',
      '1',
      'test-doc-remoteA',
      'test-doc-store',
      mockRemote,
    );
    const client2 = makeTestClient(
      'test',
      '2',
      'test-doc-remoteB',
      'test-doc-store',
      mockRemote,
    );

    // In this test, both users make the exact same edit, so we want to
    // settled on the first one that makes it to the remote
    client1.updateDoc('hello', 'client 1');
    client2.updateDoc('hello', 'client 2');

    // Wait for read
    await timeout(100);

    expect(client1.doc).toEqual('hello');
    expect(client2.doc).toEqual('hello');

    // Wait for write
    await timeout(100);

    await client1.shutdown();
    await client2.shutdown();

    await expect(dumpDatabase('test-doc-remoteA')).resolves
      .toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello",
                  ],
                  "metadata": Object {
                    "newMetadata": Object {
                      "fromRemote": 1,
                      "ref": "G0a5Az3Q",
                    },
                    "oldMetadata": "client 1",
                  },
                  "ref": "G0a5Az3Q",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "G0a5Az3Q",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);

    await expect(dumpDatabase('test-doc-remoteB')).resolves
      .toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello",
                  ],
                  "metadata": Object {
                    "newMetadata": Object {
                      "fromRemote": 1,
                      "ref": "G0a5Az3Q",
                    },
                    "oldMetadata": "client 1",
                  },
                  "ref": "G0a5Az3Q",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "G0a5Az3Q",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });

  it('updates metadata from remote with two clients on the same local store', async () => {
    const mockRemote = getMockRemoteWithMap(new Map(), (commit) => ({
      newMetadata: { fromRemote: 1, ref: commit.ref },
      oldMetadata: commit.metadata,
    }));
    const client1 = makeTestClient(
      'test',
      '1',
      'test-doc-remote3',
      'test-doc-store',
      mockRemote,
    );
    const client2 = makeTestClient(
      'test',
      '2',
      'test-doc-remote3',
      'test-doc-store',
      mockRemote,
    );

    // In this test, both users make the exact same edit, so we want to
    // settled on the first one that makes it to the remote
    client1.updateDoc('hello', 'client 1');
    client2.updateDoc('hello', 'client 2');

    // Wait for read
    await timeout(100);

    expect(client1.doc).toEqual('hello');
    await timeout(100);
    expect(client2.doc).toEqual('hello');

    // Wait for write
    await timeout(100);

    await client1.shutdown();
    await client2.shutdown();

    await expect(dumpDatabase('test-doc-remote')).resolves
      .toMatchInlineSnapshot(`
            Object {
              "commits": Array [
                Object {
                  "baseRef": undefined,
                  "delta": Array [
                    "hello",
                  ],
                  "metadata": Object {
                    "newMetadata": Object {
                      "fromRemote": 1,
                      "ref": "G0a5Az3Q",
                    },
                    "oldMetadata": "client 1",
                  },
                  "ref": "G0a5Az3Q",
                  "remoteSyncId": "foo",
                  "syncId": 1,
                },
              ],
              "heads": Array [
                Object {
                  "ref": "G0a5Az3Q",
                },
              ],
              "remotes": Array [
                Object {
                  "lastSyncCursor": "foo",
                  "localStoreId": "test-doc-store",
                },
              ],
            }
          `);
  });
});
