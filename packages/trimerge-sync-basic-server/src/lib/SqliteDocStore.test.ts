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
    expect(store.getCommitsEvent().commits).toEqual([]);
  });

  it('is deleted', async () => {
    const store = new SqliteDocStore('delete_test', testDir);
    expect(store.getCommitsEvent().commits).toEqual([]);
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
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },

        {
          ref: 'hello2',
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
          Object {
            "main": true,
            "ref": "hello1",
          },
          Object {
            "main": true,
            "ref": "hello2",
          },
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);

    expect(
      store.add([
        {
          ref: 'hello3',
          userId: 'client-2',
          editMetadata: undefined,
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {},
        "refs": Array [
          Object {
            "main": false,
            "ref": "hello3",
          },
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "ack",
      }
    `);

    expect(store.getCommitsEvent()).toMatchInlineSnapshot(`
      Object {
        "commits": Array [
          Object {
            "baseRef": undefined,
            "delta": undefined,
            "editMetadata": Object {
              "hello": "world",
            },
            "main": 1,
            "ref": "hello1",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": "hello1",
            "delta": Object {
              "delta": "format",
            },
            "editMetadata": Object {
              "hello": "world",
            },
            "main": 1,
            "ref": "hello2",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": undefined,
            "delta": undefined,
            "editMetadata": undefined,
            "main": 0,
            "ref": "hello3",
            "remoteSyncId": "1970-01-01T00:00:00.001Z",
            "userId": "client-2",
          },
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "commits",
      }
    `);

    expect(store.getCommitsEvent('1970-01-01T00:00:00.000Z'))
      .toMatchInlineSnapshot(`
      Object {
        "commits": Array [
          Object {
            "baseRef": undefined,
            "delta": undefined,
            "editMetadata": undefined,
            "main": 0,
            "ref": "hello3",
            "remoteSyncId": "1970-01-01T00:00:00.001Z",
            "userId": "client-2",
          },
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "commits",
      }
    `);
  });

  it('handles double add', async () => {
    const store = makeSqliteStore('double_add_test');

    expect(
      store.add([
        {
          ref: 'hello1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },

        {
          ref: 'hello1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {},
        "refs": Array [
          Object {
            "main": true,
            "ref": "hello1",
          },
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
          userId: 'client-2',
          baseRef: 'unknown',
          editMetadata: { hello: 'world' },
        },
        {
          ref: 'hello2',
          userId: 'client-2',
          mergeRef: 'unknown',
          editMetadata: { hello: 'world' },
        },
        {
          ref: 'hello3',
          userId: 'client-2',
          mergeBaseRef: 'unknown',
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
            "message": "unknown mergeRef",
          },
          "hello3": Object {
            "code": "unknown-ref",
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
          userId: 'client-2',
          baseRef: 'unknown',
          editMetadata: { hello: 'world' },
        },

        {
          ref: 'hello2',
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

  it('adds merge commits successfully', async () => {
    const store = makeSqliteStore('merge_commits');

    expect(
      store.add([
        {
          ref: 'hello1',
          userId: 'client-2',
          editMetadata: { hello: 'world' },
        },

        {
          ref: 'hello2',
          userId: 'client-2',
          editMetadata: { hello: 'mars' },
        },

        {
          ref: 'hello3',
          userId: 'client-2',
          baseRef: 'hello1',
          mergeRef: 'hello2',
          editMetadata: { hello: 'wmoarrlsd' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {},
        "refs": Array [
          Object {
            "main": true,
            "ref": "hello1",
          },
          Object {
            "main": false,
            "ref": "hello2",
          },
          Object {
            "main": true,
            "ref": "hello3",
          },
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);
    expect(store.getCommitsEvent()).toMatchInlineSnapshot(`
      Object {
        "commits": Array [
          Object {
            "baseRef": undefined,
            "delta": undefined,
            "editMetadata": Object {
              "hello": "world",
            },
            "main": 1,
            "ref": "hello1",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": undefined,
            "delta": undefined,
            "editMetadata": Object {
              "hello": "mars",
            },
            "main": 0,
            "ref": "hello2",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": "hello1",
            "delta": undefined,
            "editMetadata": Object {
              "hello": "wmoarrlsd",
            },
            "main": 1,
            "mergeBaseRef": undefined,
            "mergeRef": "hello2",
            "ref": "hello3",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "commits",
      }
    `);
  });
});
