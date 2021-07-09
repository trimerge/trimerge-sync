import { MemoryStore } from './MemoryStore';
import { timeout } from '../lib/Timeout';

describe('MemoryLocalStore', () => {
  it('can be shutdown twice', async () => {
    const store = new MemoryStore('test');
    const local = store.getLocalStore('test', 'test', () => 0);
    await local.shutdown();
    await local.shutdown();
  });
  it('does not send after shutdown', async () => {
    const store = new MemoryStore('test');
    const fn = jest.fn();
    const local = store.getLocalStore('test', 'test', fn);
    local.update(
      [
        {
          userId: 'test',
          clientId: 'test',
          ref: 'test1',
          editMetadata: undefined,
        },
      ],
      undefined,
    );

    // Let everything flush out first
    await timeout();

    expect(fn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "save": "pending",
            "type": "remote-state",
          },
        ],
        Array [
          Object {
            "nodes": Array [
              Object {
                "clientId": "test",
                "editMetadata": undefined,
                "ref": "test1",
                "userId": "test",
              },
            ],
            "syncId": "0",
            "type": "nodes",
          },
        ],
        Array [
          Object {
            "refs": Array [
              "test1",
            ],
            "syncId": "1",
            "type": "ack",
          },
        ],
        Array [
          Object {
            "type": "ready",
          },
        ],
        Array [
          Object {
            "save": "saving",
            "type": "remote-state",
          },
        ],
      ]
    `);

    await local.shutdown();
    local.update(
      [
        {
          userId: 'test',
          clientId: 'test',
          ref: 'test2',
          editMetadata: undefined,
        },
      ],
      undefined,
    );
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "save": "pending",
            "type": "remote-state",
          },
        ],
        Array [
          Object {
            "nodes": Array [
              Object {
                "clientId": "test",
                "editMetadata": undefined,
                "ref": "test1",
                "userId": "test",
              },
            ],
            "syncId": "0",
            "type": "nodes",
          },
        ],
        Array [
          Object {
            "refs": Array [
              "test1",
            ],
            "syncId": "1",
            "type": "ack",
          },
        ],
        Array [
          Object {
            "type": "ready",
          },
        ],
        Array [
          Object {
            "save": "saving",
            "type": "remote-state",
          },
        ],
      ]
    `);
  });
});
