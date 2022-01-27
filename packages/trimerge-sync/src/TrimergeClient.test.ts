import { AddNewCommitMetadataFn, TrimergeClient } from './TrimergeClient';
import { timeout } from './lib/Timeout';
import { OnStoreEventFn, SyncEvent } from './types';
import { Differ } from './differ';
import { migrate } from './testLib/MergeUtils';

const differ: Differ<any, any, any, any> = {
  migrate,
  diff: () => null,
  mergeAllBranches: () => null,
  patch: () => null,
  computeRef: () => 'hash',
};

function makeTrimergeClient(
  addNewCommitMetadata?: AddNewCommitMetadataFn<any>,
): {
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
    addNewCommitMetadata,
  );
  if (!onEvent) {
    throw new Error('could not get onEvent');
  }
  return { onEvent, client };
}

describe('TrimergeClient', () => {
  it('adds metadata', async () => {
    const { client } = makeTrimergeClient(
      (metadata, commitRef, userId, clientId) => {
        return {
          message: metadata,
          added: 'on client',
          userId,
          clientId,
          commitRef,
        };
      },
    );
    client.updateDoc('hello', 'hi');
    expect(client.getCommit('hash')).toMatchInlineSnapshot(`
Object {
  "baseRef": undefined,
  "delta": null,
  "metadata": Object {
    "added": "on client",
    "clientId": "",
    "commitRef": "hash",
    "message": "hi",
    "userId": "",
  },
  "ref": "hash",
}
`);
  });

  it('handles bad getCommit', async () => {
    const { client } = makeTrimergeClient();
    client.updateDoc('hello', 'hi');
    client.updateDoc('hello2', 'hi');
    client.updateDoc('hello3', 'hi');
    expect(client.getCommit('hash')).toMatchInlineSnapshot(`
Object {
  "baseRef": undefined,
  "delta": null,
  "metadata": "hi",
  "ref": "hash",
}
`);
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
