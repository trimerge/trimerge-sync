import { MemoryBroadcastChannel, resetAll } from './MemoryBroadcastChannel';
import { timeout } from './Timeout';

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

  it('await leadership', async () => {
    const on = jest.fn();
    const bc = new MemoryBroadcastChannel<string>('test', on);
    await bc.awaitLeadership();
    bc.close();
  });

  it('await leadership with two', async () => {
    const events: string[] = [];
    const bc1 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const bc2 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const p1 = bc1
      .awaitLeadership()
      .then(() => events.push('bc1 awaitLeadership'));
    const p2 = bc2
      .awaitLeadership()
      .then(() => events.push('bc2 awaitLeadership'));
    await p1;
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
      ]
    `);
    bc1.close();
    await p2;
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
      ]
    `);
    bc2.close();
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
      ]
    `);
  });

  it('await leadership after close', async () => {
    const bc1 = new MemoryBroadcastChannel<string>('test', () => undefined);
    await bc1.awaitLeadership();
    bc1.close();

    await timeout();

    const bc2 = new MemoryBroadcastChannel<string>('test', () => undefined);
    await bc2.awaitLeadership();
    bc2.close();
  });

  it('await leadership with three', async () => {
    const events: string[] = [];
    const bc1 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const bc2 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const bc3 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const p1 = bc1
      .awaitLeadership()
      .then(() => events.push('bc1 awaitLeadership'));
    const p2 = bc2
      .awaitLeadership()
      .then(() => events.push('bc2 awaitLeadership'));
    const p3 = bc3
      .awaitLeadership()
      .then(() => events.push('bc3 awaitLeadership'));
    await p1;
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
      ]
    `);
    bc1.close();
    await p2;
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
      ]
    `);
    bc3.close();
    await expect(p3).rejects.toThrowErrorMatchingInlineSnapshot(`"closed"`);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
      ]
    `);
    bc2.close();
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
      ]
    `);
  });
  it('await leadership with three then one more', async () => {
    const events: string[] = [];
    const bc1 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const bc2 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const bc3 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const p1 = bc1
      .awaitLeadership()
      .then(() => events.push('bc1 awaitLeadership'));
    const p2 = bc2
      .awaitLeadership()
      .then(() => events.push('bc2 awaitLeadership'));
    const p3 = bc3
      .awaitLeadership()
      .then(() => events.push('bc3 awaitLeadership'));
    await p1;
    bc1.close();
    await p2;
    bc2.close();
    await p3;
    bc3.close();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
        "bc3 awaitLeadership",
      ]
    `);
    const bc4 = new MemoryBroadcastChannel<string>('test', () => undefined);
    const p4 = bc4
      .awaitLeadership()
      .then(() => events.push('bc4 awaitLeadership'));
    await p4;

    expect(events).toMatchInlineSnapshot(`
      Array [
        "bc1 awaitLeadership",
        "bc2 awaitLeadership",
        "bc3 awaitLeadership",
        "bc4 awaitLeadership",
      ]
    `);
  });
});
