import { MemoryBroadcastChannel, resetAll } from './MemoryBroadcastChannel';

afterEach(() => {
  resetAll();
});

describe('MemoryBroadcastChannel', () => {
  it('broadcasts with two', async () => {
    const on1 = jest.fn();
    const bc1 = new MemoryBroadcastChannel<string>('test', on1);
    const on2 = jest.fn();
    const bc2 = new MemoryBroadcastChannel<string>('test', on2);
    await bc1.postMessage('hi');
    expect(on1.mock.calls).toMatchInlineSnapshot(`Array []`);
    expect(on2.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          "hi",
        ],
      ]
    `);
    await bc2.postMessage('there');
    expect(on1.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          "there",
        ],
      ]
    `);
    expect(on2.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          "hi",
        ],
      ]
    `);
  });
  it('closing closes', async () => {
    const on1 = jest.fn();
    const bc1 = new MemoryBroadcastChannel<string>('test', on1);
    const on2 = jest.fn();
    const bc2 = new MemoryBroadcastChannel<string>('test', on2);
    bc1.close();
    await bc2.postMessage('yo');
    expect(on1.mock.calls).toMatchInlineSnapshot(`Array []`);
    expect(on2.mock.calls).toMatchInlineSnapshot(`Array []`);
  });

  it('throw on post after close', async () => {
    const on = jest.fn();
    const bc = new MemoryBroadcastChannel<string>('test', on);
    bc.close();
    await expect(
      bc.postMessage('yo'),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"already closed"`);
  });

  it('ok to double close', async () => {
    const on = jest.fn();
    const bc = new MemoryBroadcastChannel<string>('test', on);
    bc.close();
    bc.close();
  });
});
