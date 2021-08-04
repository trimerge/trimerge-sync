import { join } from 'path';
import { unlink, readdir, mkdirp, pathExists } from 'fs-extra';
import { SqliteDocStore } from './SqliteDocStore';

const testDir = join(__dirname, '..', '_test_data');

beforeAll(async () => {
  await mkdirp(testDir);
  for (const file of await readdir(testDir)) {
    await unlink(join(testDir, file));
  }
});

function makeIdCreator() {
  let id = 0;
  return () => new Date(id++).toISOString();
}

function makeSqliteStore(docId: string) {
  return new SqliteDocStore(docId, testDir, makeIdCreator());
}

describe('SqliteDocStore', () => {
  it('is created', async () => {
    const store = new SqliteDocStore('create_test', testDir);
    expect(store.getNodesEvent().nodes).toEqual([]);
  });

  it('is deleted', async () => {
    const store = new SqliteDocStore('delete_test', testDir);
    expect(store.getNodesEvent().nodes).toEqual([]);
    const filename = join(testDir, 'delete_test.sqlite');
    await expect(pathExists(filename)).resolves.toBe(true);
    await store.delete();
    await expect(pathExists(filename)).resolves.toBe(false);
  });

  it('can be added to', async () => {
    const store = makeSqliteStore('insert_test');

    expect(
      store.add([
        {
          ref: 'hello1',
          clientId: 'client-1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },
        {
          ref: 'hello2',
          clientId: 'client-1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
          baseRef: 'hello1',
          delta: { delta: 'format' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {},
        "refs": Array [
          "hello1",
          "hello2",
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);

    expect(
      store.add([
        {
          ref: 'hello3',
          clientId: 'client-1',
          userId: 'client-2',
          editMetadata: undefined,
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {},
        "refs": Array [
          "hello3",
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "ack",
      }
    `);

    expect(store.getNodesEvent()).toMatchInlineSnapshot(`
      Object {
        "nodes": Array [
          Object {
            "baseRef": undefined,
            "clientId": "client-1",
            "delta": undefined,
            "editMetadata": Object {
              "hello": "world",
            },
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "hello1",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": "hello1",
            "clientId": "client-1",
            "delta": Object {
              "delta": "format",
            },
            "editMetadata": Object {
              "hello": "world",
            },
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "hello2",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": undefined,
            "clientId": "client-1",
            "delta": undefined,
            "editMetadata": undefined,
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "hello3",
            "remoteSyncId": "1970-01-01T00:00:00.001Z",
            "userId": "client-2",
          },
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "nodes",
      }
    `);

    expect(store.getNodesEvent('1970-01-01T00:00:00.000Z'))
      .toMatchInlineSnapshot(`
      Object {
        "nodes": Array [
          Object {
            "baseRef": undefined,
            "clientId": "client-1",
            "delta": undefined,
            "editMetadata": undefined,
            "mergeBaseRef": undefined,
            "mergeRef": undefined,
            "ref": "hello3",
            "remoteSyncId": "1970-01-01T00:00:00.001Z",
            "userId": "client-2",
          },
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "nodes",
      }
    `);
  });

  it('handles double add', async () => {
    const store = makeSqliteStore('double_add_test');

    expect(
      store.add([
        {
          ref: 'hello1',
          clientId: 'client-1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },
        {
          ref: 'hello1',
          clientId: 'client-1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {},
        "refs": Array [
          "hello1",
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);
  });

  it('handles missing baseRef', async () => {
    const store = makeSqliteStore('missing_tests');

    expect(
      store.add([
        {
          ref: 'hello1',
          clientId: 'client-1',
          userId: 'client-2',
          baseRef: 'unknown',
          editMetadata: { hello: 'world' },
        },
        {
          ref: 'hello2',
          clientId: 'client-1',
          userId: 'client-2',
          mergeRef: 'unknown',
          editMetadata: { hello: 'world' },
        },
        {
          ref: 'hello3',
          clientId: 'client-1',
          userId: 'client-2',
          mergeBaseRef: 'unknown',
          editMetadata: { hello: 'world' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {
          "hello1": Object {
            "code": "invalid-node",
            "message": "unknown baseRef",
          },
          "hello2": Object {
            "code": "invalid-node",
            "message": "unknown mergeRef",
          },
          "hello3": Object {
            "code": "invalid-node",
            "message": "unknown mergeBaseRef",
          },
        },
        "refs": Array [],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);
  });

  it('handles missing baseRef in chain', async () => {
    const store = makeSqliteStore('missing_tests');

    expect(
      store.add([
        {
          ref: 'hello1',
          clientId: 'client-1',
          userId: 'client-2',
          baseRef: 'unknown',
          editMetadata: { hello: 'world' },
        },

        {
          ref: 'hello2',
          clientId: 'client-1',
          userId: 'client-2',
          baseRef: 'hello1',
          editMetadata: { hello: 'world' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {
          "hello1": Object {
            "code": "unknown-ref",
            "message": "unknown baseRef",
          },
          "hello2": Object {
            "code": "unknown-ref",
            "message": "unknown baseRef",
          },
        },
        "refs": Array [],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);
  });
});
