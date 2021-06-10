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
    let id = 0;
    const store = new SqliteDocStore('insert_test', testDir, () =>
      new Date(id++).toISOString(),
    );

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
          mergeRef: 'merge-ref',
          mergeBaseRef: 'merge-base-ref',
          baseRef: 'hello1',
          delta: { delta: 'format' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
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
          editMetadata: { hello: 'world' },
        },
      ]),
    ).toMatchInlineSnapshot(`
      Object {
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
            "mergeBaseRef": "merge-base-ref",
            "mergeRef": "merge-ref",
            "ref": "hello2",
            "remoteSyncId": "1970-01-01T00:00:00.000Z",
            "userId": "client-2",
          },
          Object {
            "baseRef": undefined,
            "clientId": "client-1",
            "delta": undefined,
            "editMetadata": Object {
              "hello": "world",
            },
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
            "editMetadata": Object {
              "hello": "world",
            },
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
});
