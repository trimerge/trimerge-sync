import {
  MemoryBroadcastChannel,
  resetAll,
  setChannelsPaused,
} from './MemoryBroadcastChannel';
import { timeout } from '../lib/Timeout';

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
    expect(on1.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(on2.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "hi",
        ],
      ]
    `);
    await bc2.postMessage('there');
    expect(on1.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "there",
        ],
      ]
    `);
    expect(on2.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "hi",
        ],
      ]
    `);
  });

  it('pauses broadcasting', async () => {
    const on1 = jest.fn();
    const bc1 = new MemoryBroadcastChannel<string>('test', on1);
    const on2 = jest.fn();
    const bc2 = new MemoryBroadcastChannel<string>('test', on2);

    bc1.paused = true;

    await bc1.postMessage('hi 1');
    await bc2.postMessage('hi 2');

    expect(on1.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(on2.mock.calls).toMatchInlineSnapshot(`[]`);

    bc1.paused = false;

    await timeout();

    expect(on1.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "hi 2",
        ],
      ]
    `);
    expect(on2.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "hi 1",
        ],
      ]
    `);
  });
  it('setChannelsPaused', async () => {
    const on1 = jest.fn();
    const bc1 = new MemoryBroadcastChannel<string>('test', on1);
    const on2 = jest.fn();
    const bc2 = new MemoryBroadcastChannel<string>('test', on2);

    setChannelsPaused(true);

    await bc1.postMessage('hi 1');
    await bc2.postMessage('hi 2');

    expect(on1.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(on2.mock.calls).toMatchInlineSnapshot(`[]`);

    setChannelsPaused(false);

    await timeout();

    expect(on1.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "hi 2",
        ],
      ]
    `);
    expect(on2.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "hi 1",
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
    expect(on1.mock.calls).toMatchInlineSnapshot(`[]`);
    expect(on2.mock.calls).toMatchInlineSnapshot(`[]`);
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
