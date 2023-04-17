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
          metadata: {
            clientId: 'client-1',
            hello: 'world',
          },
        },

        {
          ref: 'hello2',
          metadata: {
            clientId: 'client-1',
            hello: 'world',
          },

          baseRef: 'hello1',
          delta: JSON.stringify({ delta: 'format' }),
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "acks": [
          {
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello1",
          },
          {
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 1,
              },
            },
            "ref": "hello2",
          },
        ],
        "refErrors": {},
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);

    expect(
      store.add([
        {
          ref: 'hello3',
          metadata: {},
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "acks": [
          {
            "metadata": {
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.001Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello3",
          },
        ],
        "refErrors": {},
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "ack",
      }
    `);

    expect(store.getCommitsEvent()).toMatchInlineSnapshot(`
      {
        "commits": [
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello1",
          },
          {
            "baseRef": "hello1",
            "delta": "{"delta":"format"}",
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 1,
              },
            },
            "ref": "hello2",
          },
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.001Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello3",
          },
        ],
        "syncId": "1970-01-01T00:00:00.001Z",
        "type": "commits",
      }
    `);

    expect(store.getCommitsEvent('1970-01-01T00:00:00.000Z'))
      .toMatchInlineSnapshot(`
      {
        "commits": [
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.001Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello3",
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
          metadata: { hello: 'world', clientId: 'client-1' },
        },

        {
          ref: 'hello1',
          metadata: { hello: 'world', clientId: 'client-1' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "acks": [
          {
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello1",
          },
        ],
        "refErrors": {},
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
          baseRef: 'unknown',
          metadata: { hello: 'world', clientId: 'client-2' },
        },

        {
          ref: 'hello2',
          mergeRef: 'unknown',
          metadata: { hello: 'world', clientId: 'client-2' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "acks": [],
        "refErrors": {
          "hello1": {
            "code": "unknown-ref",
            "message": "unknown baseRef",
          },
          "hello2": {
            "code": "unknown-ref",
            "message": "unknown mergeRef",
          },
        },
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
          baseRef: 'unknown',
          metadata: { hello: 'world', clientId: 'client-2' },
        },

        {
          ref: 'hello2',
          baseRef: 'hello1',
          metadata: { hello: 'world', clientId: 'client-2' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "acks": [],
        "refErrors": {
          "hello1": {
            "code": "unknown-ref",
            "message": "unknown baseRef",
          },
          "hello2": {
            "code": "unknown-ref",
            "message": "unknown baseRef",
          },
        },
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
          metadata: { hello: 'world', clientId: 'client-1' },
        },

        {
          ref: 'hello2',
          metadata: { hello: 'mars', clientId: 'client-2' },
        },

        {
          ref: 'hello3',
          baseRef: 'hello1',
          mergeRef: 'hello2',
          metadata: { hello: 'wmoarrlsd', clientId: 'client-1' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      {
        "acks": [
          {
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello1",
          },
          {
            "metadata": {
              "clientId": "client-2",
              "hello": "mars",
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 1,
              },
            },
            "ref": "hello2",
          },
          {
            "metadata": {
              "clientId": "client-1",
              "hello": "wmoarrlsd",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 2,
              },
            },
            "ref": "hello3",
          },
        ],
        "refErrors": {},
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);
    expect(store.getCommitsEvent()).toMatchInlineSnapshot(`
      {
        "commits": [
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello1",
          },
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "clientId": "client-2",
              "hello": "mars",
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 1,
              },
            },
            "ref": "hello2",
          },
          {
            "baseRef": "hello1",
            "delta": null,
            "mergeRef": "hello2",
            "metadata": {
              "clientId": "client-1",
              "hello": "wmoarrlsd",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 2,
              },
            },
            "ref": "hello3",
          },
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "commits",
      }
    `);
  });
  it('existing db', async () => {
    let store = makeSqliteStore('existing db');

    store.add([
      {
        ref: 'hello1',
        metadata: { hello: 'world', clientId: 'client-1' },
      },

      {
        ref: 'hello2',
        metadata: { hello: 'mars', clientId: 'client-2' },
      },

      {
        ref: 'hello3',
        baseRef: 'hello1',
        mergeRef: 'hello2',
        metadata: { hello: 'wmoarrlsd', clientId: 'client-1' },
      },
    ]);

    store.close();

    store = makeSqliteStore('existing db');

    store.add([
      {
        ref: 'hello4',
        baseRef: 'hello3',
        metadata: { hello: 'blargan', clientId: 'client-1' },
      },
    ]);

    expect(store.getCommitsEvent()).toMatchInlineSnapshot(`
      {
        "commits": [
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "clientId": "client-1",
              "hello": "world",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello1",
          },
          {
            "baseRef": "hello3",
            "delta": null,
            "metadata": {
              "clientId": "client-1",
              "hello": "blargan",
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 0,
              },
            },
            "ref": "hello4",
          },
          {
            "baseRef": undefined,
            "delta": null,
            "metadata": {
              "clientId": "client-2",
              "hello": "mars",
              "server": {
                "main": false,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 1,
              },
            },
            "ref": "hello2",
          },
          {
            "baseRef": "hello1",
            "delta": null,
            "mergeRef": "hello2",
            "metadata": {
              "clientId": "client-1",
              "hello": "wmoarrlsd",
              "server": {
                "main": true,
                "remoteSyncId": "1970-01-01T00:00:00.000Z",
                "remoteSyncIndex": 2,
              },
            },
            "ref": "hello3",
          },
        ],
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "commits",
      }
    `);
  });
});
