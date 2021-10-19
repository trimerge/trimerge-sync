import { TrimergeClient } from './TrimergeClient';
import { timeout } from './lib/Timeout';
import { OnEventFn, SyncEvent } from './types';
import { Differ } from './differ';
import { migrate } from './testLib/MergeUtils';

const differ: Differ<any, any, any, any> = {
  migrate,
  diff: () => null,
  merge: () => ({ state: undefined, editMetadata: undefined }),
  patch: () => null,
  computeRef: () => 'hash',
};

function makeTrimergeClient(): {
  client: TrimergeClient<any, any, any, any, any>;
  onEvent: OnEventFn<any, any, any>;
} {
  let onEvent: OnEventFn<any, any, any> | undefined;
  const client = new TrimergeClient(
    '',
    '',
    (userId, clientId, _onEvent) => {
      onEvent = _onEvent;
      return {
        update: () => undefined,
        shutdown: () => undefined,
        isRemoteLeader: false,
      };
    },
    differ,
    0,
  );
  if (!onEvent) {
    throw new Error('could not get onEvent');
  }
  return { onEvent, client };
}

describe('TrimergeClient', () => {
  it('handles bad getCommit', async () => {
    const { client } = makeTrimergeClient();
    client.updateState('hello', 'hi');
    client.updateState('hello2', 'hi');
    client.updateState('hello3', 'hi');
    await timeout(100);
  });

  it('handles event with invalid baseRef', async () => {
    const { onEvent } = makeTrimergeClient();
    expect(() =>
      onEvent({
        type: 'commits',
        commits: [
          {
            clientId: '',
            userId: '',
            ref: 'a',
            baseRef: 'unknown',
            editMetadata: '',
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"unknown baseRef unknown"`);
  });
  it('handles event with invalid mergeRef', async () => {
    const { onEvent } = makeTrimergeClient();
    expect(() =>
      onEvent({
        type: 'commits',
        commits: [
          {
            clientId: '',
            userId: '',
            ref: 'a',
            mergeRef: 'unknown',
            editMetadata: '',
          },
        ],
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"unknown mergeRef unknown"`);
  });

  it('handles internal error', async () => {
    const { onEvent, client } = makeTrimergeClient();
    onEvent({
      type: 'error',
      code: 'internal',
      reconnect: false,
      message: 'testing fake error',
      fatal: true,
    });
    await timeout();
    expect(client.syncStatus.localRead).toEqual('error');
  });

  it('ignores other error', async () => {
    const { onEvent, client } = makeTrimergeClient();
    onEvent({
      type: 'error',
      code: 'internal',
      reconnect: false,
      message: 'testing fake error',
      fatal: false,
    });
    await timeout();
    expect(client.syncStatus.localRead).toEqual('error');
  });

  it('handles unknown event type', async () => {
    const { onEvent } = makeTrimergeClient();
    // This just logs a warning, added for code coverage
    onEvent({ type: 'fake-event' } as unknown as SyncEvent<any, any, any>);
    await timeout();
  });
  it('fails on leader event with no leader', async () => {
    const { onEvent } = makeTrimergeClient();
    // This just logs a warning, added for code coverage
    onEvent({ type: 'leader', clientId: '', action: 'accept' });
    await timeout();
  });
});
