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
      [
        [
          {
            "connect": "offline",
            "read": "offline",
            "save": "ready",
            "type": "remote-state",
          },
          false,
        ],
        [
          {
            "commits": [
              {
                "metadata": undefined,
                "ref": "test1",
              },
            ],
            "syncId": "0",
            "type": "commits",
          },
          false,
        ],
        [
          {
            "type": "ready",
          },
          false,
        ],
        [
          {
            "connect": "offline",
            "read": "offline",
            "save": "pending",
            "type": "remote-state",
          },
          false,
        ],
        [
          {
            "acks": [
              {
                "ref": "test1",
              },
            ],
            "syncId": "1",
            "type": "ack",
          },
          false,
        ],
        [
          {
            "connect": "offline",
            "read": "offline",
            "save": "saving",
            "type": "remote-state",
          },
          false,
        ],
        [
          {
            "info": {
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
