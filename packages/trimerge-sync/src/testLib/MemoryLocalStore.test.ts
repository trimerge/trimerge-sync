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
    expect(fn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "save": "pending",
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
      ]
    `);
  });
});
