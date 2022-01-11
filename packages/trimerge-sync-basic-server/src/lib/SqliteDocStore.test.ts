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
          userId: 'user-2',
          metadata: {
            clientId: 'client-1',
            hello: 'world',
          },
        },

        {
          ref: 'hello2',
          userId: 'user-2',
          metadata: {
            clientId: 'client-1',
            hello: 'world',
          },
          baseRef: 'hello1',
          delta: { delta: 'format' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "acks": Array [
          Object {
            "main": true,
            "ref": "hello1",
          },
          Object {
            "main": true,
            "ref": "hello2",
          },
        ],
        "refErrors": Object {},
        "syncId": "1970-01-01T00:00:00.000Z",
        "type": "ack",
      }
    `);

    expect(
      store.add([
        {
          ref: 'hello3',
          userId: 'client-2',
          metadata: undefined,
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "acks": Array [
          Object {
            "main": false,
            "ref": "hello3",
          },
        ],
        "refErrors": Object {},
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
            "main": true,
            "metadata": Object {
              "clientId": "client-1",
              "hello": "world",
            },
            "ref": "hello1",
            "userId": "user-2",
          },
          Object {
            "baseRef": "hello1",
            "delta": Object {
              "delta": "format",
            },
            "main": true,
            "metadata": Object {
              "clientId": "client-1",
              "hello": "world",
            },
            "ref": "hello2",
            "userId": "user-2",
          },
          Object {
            "baseRef": undefined,
            "delta": undefined,
            "main": false,
            "metadata": undefined,
            "ref": "hello3",
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
            "main": false,
            "metadata": undefined,
            "ref": "hello3",
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
          metadata: { hello: 'world', clientId: 'client-1' },
        },

        {
          ref: 'hello1',
          userId: 'client-2',
          metadata: { hello: 'world', clientId: 'client-1' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "acks": Array [
          Object {
            "main": true,
            "ref": "hello1",
          },
        ],
        "refErrors": Object {},
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
          metadata: { hello: 'world', clientId: 'client-2' },
        },

        {
          ref: 'hello2',
          userId: 'client-2',
          mergeRef: 'unknown',
          metadata: { hello: 'world', clientId: 'client-2' },
        },

        {
          ref: 'hello3',
          userId: 'client-2',
          mergeBaseRef: 'unknown',
          metadata: { hello: 'world', clientId: 'client-2' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "acks": Array [],
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
          metadata: { hello: 'world', clientId: 'client-2' },
        },

        {
          ref: 'hello2',
          userId: 'client-2',
          baseRef: 'hello1',
          metadata: { hello: 'world', clientId: 'client-2' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "acks": Array [],
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
          userId: 'user-2',
          metadata: { hello: 'world', clientId: 'client-1' },
        },

        {
          ref: 'hello2',
          userId: 'user-2',
          metadata: { hello: 'mars', clientId: 'client-2' },
        },

        {
          ref: 'hello3',
          userId: 'client-2',
          baseRef: 'hello1',
          mergeRef: 'hello2',
          metadata: { hello: 'wmoarrlsd', clientId: 'client-1' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "acks": Array [
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
        "refErrors": Object {},
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
      "main": true,
      "metadata": Object {
        "clientId": "client-1",
        "hello": "world",
      },
      "ref": "hello1",
      "userId": "user-2",
    },
    Object {
      "baseRef": undefined,
      "delta": undefined,
      "main": false,
      "metadata": Object {
        "clientId": "client-2",
        "hello": "mars",
      },
      "ref": "hello2",
      "userId": "user-2",
    },
    Object {
      "baseRef": "hello1",
      "delta": undefined,
      "main": true,
      "mergeBaseRef": undefined,
      "mergeRef": "hello2",
      "metadata": Object {
        "clientId": "client-1",
        "hello": "wmoarrlsd",
      },
      "ref": "hello3",
      "userId": "client-2",
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
        userId: 'user-2',
        metadata: { hello: 'world', clientId: 'client-1' },
      },

      {
        ref: 'hello2',
        userId: 'user-2',
        metadata: { hello: 'mars', clientId: 'client-2' },
      },

      {
        ref: 'hello3',
        userId: 'user-2',
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
        userId: 'user-2',
        baseRef: 'hello3',
        metadata: { hello: 'blargan', clientId: 'client-1' },
      },
    ]);

    expect(store.getCommitsEvent()).toMatchInlineSnapshot(`
Object {
  "commits": Array [
    Object {
      "baseRef": undefined,
      "delta": undefined,
      "main": true,
      "metadata": Object {
        "clientId": "client-1",
        "hello": "world",
      },
      "ref": "hello1",
      "userId": "user-2",
    },
    Object {
      "baseRef": "hello3",
      "delta": undefined,
      "main": false,
      "metadata": Object {
        "clientId": "client-1",
        "hello": "blargan",
      },
      "ref": "hello4",
      "userId": "user-2",
    },
    Object {
      "baseRef": undefined,
      "delta": undefined,
      "main": false,
      "metadata": Object {
        "clientId": "client-2",
        "hello": "mars",
      },
      "ref": "hello2",
      "userId": "user-2",
    },
    Object {
      "baseRef": "hello1",
      "delta": undefined,
      "main": true,
      "mergeBaseRef": undefined,
      "mergeRef": "hello2",
      "metadata": Object {
        "clientId": "client-1",
        "hello": "wmoarrlsd",
      },
      "ref": "hello3",
      "userId": "user-2",
    },
  ],
  "syncId": "1970-01-01T00:00:00.000Z",
  "type": "commits",
}
`);
  });
});
