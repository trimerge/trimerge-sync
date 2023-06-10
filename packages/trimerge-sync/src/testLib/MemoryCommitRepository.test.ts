import { MemoryStore } from './MemoryStore';

describe('MemoryLocalStore', () => {
  it('fails on multiple shutdown', async () => {
    const store = new MemoryStore('test');
    const local = store.getLocalStore({
      userId: 'test',
      clientId: 'test',
    });
    await local.shutdown();
    await expect(async () => await local.shutdown()).rejects.toThrow();
  });
  it('does not allow updates after shutdown', async () => {
    const store = new MemoryStore('test');
    const local = store.getLocalStore({
      userId: 'test',
      clientId: 'test',
    });
    const fn = jest.fn();
    local.listen(fn);
    await local.update(
      [
        {
          ref: 'test1',
          metadata: undefined,
        },
      ],
      undefined,
    );

    await local.shutdown();
    const callsDuringLifetime = [...fn.mock.calls];

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
            "connect": "offline",
            "read": "offline",
            "save": "pending",
            "type": "remote-state",
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
            "acks": [
              {
                "metadata": undefined,
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

    expect(
      local.update(
        [
          {
            ref: 'test2',
            metadata: undefined,
          },
        ],
        undefined,
      ),
    ).rejects.toThrow();
    expect(fn.mock.calls).toEqual(callsDuringLifetime);
  });
});
