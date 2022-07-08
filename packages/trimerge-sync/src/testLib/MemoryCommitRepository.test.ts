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
      "read": "loading",
      "save": "pending",
      "type": "remote-state",
    },
    false,
  ],
  Array [
    Object {
      "code": "invalid-commits",
      "fatal": true,
      "message": "Cannot read properties of undefined (reading 'deltaCodec')",
      "type": "error",
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
