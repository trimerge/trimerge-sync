import {
  MemoryBroadcastChannel,
  resetAll,
} from '../testLib/MemoryBroadcastChannel';
import { timeout } from '../testLib/Timeout';
import { LeaderManager } from './LeaderManager';
import { LeaderEvent } from '../types';

type CloseFn = (cleanShutdown?: boolean) => Promise<void>;
let pendingCloseFunctions: CloseFn[] = [];

afterEach(async () => {
  for (const close of pendingCloseFunctions) {
    await close();
  }
  resetAll();
  pendingCloseFunctions = [];
});

function makeLeaderManager(
  clientId: string,
  events: string[],
): { paused: boolean; close: CloseFn } {
  const channel = new MemoryBroadcastChannel<LeaderEvent>(
    'test',
    () => undefined,
  );
  let paused = false;
  let pauseChannelQueue: LeaderEvent[] = [];
  let pauseLeaderQueue: LeaderEvent[] = [];
  const leaderManagement = new LeaderManager(
    clientId,
    (isLeader) =>
      events.push(
        `${clientId} is ${isLeader ? 'promoted to leader' : 'demoted'}`,
      ),
    (event) => {
      if (paused) {
        pauseChannelQueue.push(event);
      } else {
        channel.postMessage(event);
      }
    },
    {
      electionTimeoutMs: 0,
      heartbeatMs: 10,
      heartbeatTimeoutMs: 50,
    },
  );
  channel.onEvent = (event) => {
    if (paused) {
      pauseLeaderQueue.push(event);
    } else {
      leaderManagement.receiveEvent(event);
    }
  };
  async function close(cleanShutdown: boolean | undefined) {
    leaderManagement.close(cleanShutdown);
    channel.close();

    paused = true;

    // need to wait for messages to send
    await timeout();
    await timeout();
  }
  pendingCloseFunctions.push(close);
  return {
    set paused(p: boolean) {
      paused = p;
      if (!paused) {
        // Send queued events
        for (const e of pauseChannelQueue) {
          void channel.postMessage(e);
        }
        pauseChannelQueue = [];
        for (const e of pauseLeaderQueue) {
          leaderManagement.receiveEvent(e);
        }
        pauseLeaderQueue = [];
      }
    },
    close,
  };
}

describe('LeaderManagement', () => {
  it('makes leader of 1', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);
    await lm1.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);
  });

  it('ignores events after close', async () => {
    const events: LeaderEvent[] = [];
    const lm = new LeaderManager(
      'test',
      () => {
        throw new Error('unexpected');
      },
      (e) => {
        events.push(e);
      },
    );
    lm.close();
    await timeout();
    lm.receiveEvent({ type: 'leader', action: 'request', clientId: 'foo' });
    expect(events).toMatchInlineSnapshot(`
      Array [
        Object {
          "action": "request",
          "clientId": "test",
          "type": "leader",
        },
        Object {
          "action": "withdraw",
          "clientId": "test",
          "type": "leader",
        },
      ]
    `);
  });

  it('allows double-close', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    await lm1.close(true);
    await lm1.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "b is promoted to leader",
      ]
    `);
    await lm2.close(true);
  });

  it('makes leader with 2, transfers after close', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    await lm1.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    await lm2.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);
  });

  it('makes leader with 2, then 1', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);

    await timeout();

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    const lm3 = makeLeaderManager('0', events);

    await timeout();

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    await lm1.close(true);
    await lm2.close(true);
    await lm3.close(true);
  });

  it('handles close while electing', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);

    await lm1.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "b is promoted to leader",
      ]
    `);

    await lm2.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "b is promoted to leader",
      ]
    `);
  });

  it('makes leader with 2, transfers after unclean shutdown', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);
    await lm1.close(false);

    // Wait for 50ms timeout
    await timeout(200);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    await lm2.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);
  });

  it('makes leader with 2, handles network split', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    makeLeaderManager('b', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    lm1.paused = true;

    // Wait for 50ms timeout
    await timeout(100);

    // Now both sides are leaders
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    lm1.paused = false;

    // Wait for timeout again
    await timeout(100);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
        "b is demoted",
      ]
    `);
  });
  it('makes leader with 3, handles network split', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    const lm3 = makeLeaderManager('c', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    lm1.paused = true;
    lm2.paused = true;
    lm3.paused = true;

    // Wait for 50ms timeout
    await timeout(100);

    // Now both sides are leaders
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
        "c is promoted to leader",
      ]
    `);

    lm1.paused = false;
    lm2.paused = false;
    lm3.paused = false;

    // Wait for timeout again
    await timeout(100);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
        "c is promoted to leader",
        "b is demoted",
        "c is demoted",
      ]
    `);
  });
  it('makes leader with 2, handles network split (reverse)', async () => {
    const events: string[] = [];
    makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    lm2.paused = true;

    // Wait for 50ms timeout
    await timeout(100);

    // Now both sides are leaders
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    lm2.paused = false;

    // Wait for timeout again
    await timeout(100);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
        "b is demoted",
      ]
    `);
  });

  it('1st leader closes before 2nd starts', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);
    await lm1.close(true);

    const lm2 = makeLeaderManager('b', events);
    await timeout();

    await lm2.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);
  });

  it('2nd joins after initial leader election', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    const lm2 = makeLeaderManager('b', events);
    await timeout();

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    await lm2.close(true);
    await lm1.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);
  });

  it('2nd joins after initial leader election (reverse)', async () => {
    const events: string[] = [];
    const lm2 = makeLeaderManager('b', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "b is promoted to leader",
      ]
    `);

    const lm1 = makeLeaderManager('a', events);
    await timeout();

    expect(events).toMatchInlineSnapshot(`
      Array [
        "b is promoted to leader",
      ]
    `);

    await lm2.close(true);
    await lm1.close(true);
  });

  it('handles 3 leaders', async () => {
    const events: string[] = [];

    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    const lm3 = makeLeaderManager('c', events);

    await timeout();

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    await lm1.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    await lm3.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    await lm2.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);
  });
  it('handles 3 closing then a 4th', async () => {
    const events: string[] = [];
    const lm1 = makeLeaderManager('a', events);
    const lm2 = makeLeaderManager('b', events);
    const lm3 = makeLeaderManager('c', events);
    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
      ]
    `);

    await lm1.close(true);

    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    await lm3.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    await lm2.close(true);
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
      ]
    `);

    makeLeaderManager('d', events);

    await timeout();
    expect(events).toMatchInlineSnapshot(`
      Array [
        "a is promoted to leader",
        "b is promoted to leader",
        "d is promoted to leader",
      ]
    `);
  });
});
