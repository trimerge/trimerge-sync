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
          ref: 'test1',
          metadata: undefined,
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
      "connect": "offline",
      "read": "offline",
      "save": "pending",
      "type": "remote-state",
    },
  ],
  Array [
    Object {
      "commits": Array [
        Object {
          "metadata": undefined,
          "ref": "test1",
          "userId": "test",
        },
      ],
      "syncId": "0",
      "type": "commits",
    },
  ],
  Array [
    Object {
      "acks": Array [
        Object {
          "ref": "test1",
        },
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
      "connect": "offline",
      "read": "offline",
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
          ref: 'test2',
          metadata: undefined,
        },
      ],
      undefined,
    );
    expect(fn.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    Object {
      "connect": "offline",
      "read": "offline",
      "save": "pending",
      "type": "remote-state",
    },
  ],
  Array [
    Object {
      "commits": Array [
        Object {
          "metadata": undefined,
          "ref": "test1",
          "userId": "test",
        },
      ],
      "syncId": "0",
      "type": "commits",
    },
  ],
  Array [
    Object {
      "acks": Array [
        Object {
          "ref": "test1",
        },
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
      "connect": "offline",
      "read": "offline",
      "save": "saving",
      "type": "remote-state",
    },
  ],
]
`);
  });
});
