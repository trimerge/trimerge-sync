import { timeout } from '../lib/Timeout';
import { MemoryStore } from './MemoryStore';

describe('MemoryLocalStore', () => {
  it('can be shutdown twice', async () => {
    const store = new MemoryStore('shutdown-twice');
    const local = store.getLocalStore('test', 'test', () => 0);
    await local.shutdown();
    await local.shutdown();
  });
  it('does not allow updates after shutdown', async () => {
    const store = new MemoryStore('updates-after-shutdown');
    const fn = jest.fn();
    const local = store.getLocalStore('test', 'test', fn);
    local.configureLogger(console);

    // wait for init
    await timeout(10);

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
      ]
    `);

    await local.shutdown();
    await expect(
      local.update(
        [
          {
            ref: 'test2',
            metadata: undefined,
          },
        ],
        undefined,
      ),
    ).rejects.toThrowError();
    expect(fn.mock.calls).toEqual(callsBeforeShutdown);
  });
});
