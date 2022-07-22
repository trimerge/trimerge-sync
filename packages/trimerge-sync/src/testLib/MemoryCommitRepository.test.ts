import { MemoryStore } from './MemoryStore';

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
    await local.update(
      [
        {
          ref: 'test1',
          metadata: undefined,
        },
      ],
      undefined,
    );

    const callsBeforeShutdown = [...fn.mock.calls];

    expect(fn.mock.calls).toMatchInlineSnapshot(`
Array [
  Array [
    Object {
      "connect": "offline",
      "read": "offline",
      "save": "ready",
      "type": "remote-state",
    },
    false,
  ],
  Array [
    Object {
      "commits": Array [],
      "syncId": "0",
      "type": "commits",
    },
    false,
  ],
  Array [
    Object {
      "type": "ready",
    },
    false,
  ],
  Array [
    Object {
      "connect": "offline",
      "read": "offline",
      "save": "pending",
      "type": "remote-state",
    },
    false,
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
    false,
  ],
  Array [
    Object {
      "connect": "offline",
      "read": "offline",
      "save": "saving",
      "type": "remote-state",
    },
    false,
  ],
  Array [
    Object {
      "info": Object {
        "clientId": "test",
        "presence": undefined,
        "ref": undefined,
        "userId": "test",
      },
      "type": "client-presence",
    },
    false,
  ],
]
`);

    await local.shutdown();
    await local.update(
      [
        {
          ref: 'test2',
          metadata: undefined,
        },
      ],
      undefined,
    );
    expect(fn.mock.calls).toEqual(callsBeforeShutdown);
  });
});
