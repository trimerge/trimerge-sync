import { TrimergeClient } from './TrimergeClient';
import { timeout } from './lib/Timeout';
import { OnStoreEventFn, SyncEvent } from './types';
import { Differ } from './differ';
import { migrate } from './testLib/MergeUtils';

const differ: Differ<any, any, any, any> = {
  migrate,
  diff: () => null,
  merge: () => ({ doc: undefined, editMetadata: undefined }),
  patch: () => null,
  computeRef: () => 'hash',
};

function makeTrimergeClient(): {
  client: TrimergeClient<any, any, any, any, any>;
  onEvent: OnStoreEventFn<any, any, any>;
} {
  let onEvent: OnStoreEventFn<any, any, any> | undefined;
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
  );
  if (!onEvent) {
    throw new Error('could not get onEvent');
  }
  return { onEvent, client };
}

describe('TrimergeClient', () => {
  it('handles bad getCommit', async () => {
    const { client } = makeTrimergeClient();
    client.updateDoc('hello', 'hi');
    client.updateDoc('hello2', 'hi');
    client.updateDoc('hello3', 'hi');
    await timeout(100);
    expect(() => client.getCommit('xxx')).toThrowError(`unknown ref "xxx"`);
  });

  it('handles event with invalid baseRef', async () => {
    const { onEvent } = makeTrimergeClient();
    expect(() =>
      onEvent(
        {
          type: 'commits',
          commits: [
            {
              userId: '',
              ref: 'a',
              baseRef: 'unknown',
              metadata: '',
            },
          ],
        },
        false,
      ),
    ).toThrowErrorMatchingInlineSnapshot(`"unknown baseRef unknown"`);
  });
  it('handles event with invalid mergeRef', async () => {
    const { onEvent } = makeTrimergeClient();
    expect(() =>
      onEvent(
        {
          type: 'commits',
          commits: [
            {
              userId: '',
              ref: 'a',
              mergeRef: 'unknown',
              metadata: '',
            },
          ],
        },
        false,
      ),
    ).toThrowErrorMatchingInlineSnapshot(`"unknown mergeRef unknown"`);
  });

  it('handles internal error', async () => {
    const { onEvent, client } = makeTrimergeClient();
    onEvent(
      {
        type: 'error',
        code: 'internal',
        reconnect: false,
        message: 'testing fake error',
        fatal: true,
      },
      false,
    );
    await timeout();
    expect(client.syncStatus.localRead).toEqual('error');
  });

  it('ignores other error', async () => {
    const { onEvent, client } = makeTrimergeClient();
    onEvent(
      {
        type: 'error',
        code: 'internal',
        reconnect: false,
        message: 'testing fake error',
        fatal: false,
      },
      false,
    );
    await timeout();
    expect(client.syncStatus.localRead).toEqual('error');
  });

  it('handles unknown event type', async () => {
    const { onEvent } = makeTrimergeClient();
    // This just logs a warning, added for code coverage
    onEvent(
      { type: 'fake-event' } as unknown as SyncEvent<any, any, any>,
      false,
    );
    await timeout();
  });
  it('fails on leader event with no leader', async () => {
    const { onEvent } = makeTrimergeClient();
    // This just logs a warning, added for code coverage
    onEvent({ type: 'leader', clientId: '', action: 'accept' }, false);
    await timeout();
  });
});
