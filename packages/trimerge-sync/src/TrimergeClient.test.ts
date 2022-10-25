import { TrimergeClient } from './TrimergeClient';
import { timeout } from './lib/Timeout';
import { OnStoreEventFn, SyncEvent, SyncStatus } from './types';
import {
  Differ,
  TrimergeClientOptions,
  AddNewCommitMetadataFn,
} from './TrimergeClientOptions';

import { create } from 'jsondiffpatch';
import { computeRef } from 'trimerge-sync-hash';
import { InMemoryDocCache } from './InMemoryDocCache';

const jsonDiffPatch = create({ textDiff: { minLength: 20 } });

const JDP_DIFFER: Differ<any, any> = {
  diff: (left, right) => JSON.stringify(jsonDiffPatch.diff(left, right)),
  patch: (base, delta) => jsonDiffPatch.patch(base, JSON.parse(delta)),
};

const NOOP_DIFFER: Differ<any, any> = {
  diff: () => null,
  patch: () => null,
};

function makeTrimergeClient(
  addNewCommitMetadata?: AddNewCommitMetadataFn<any>,
  {
    computeRef = () => 'hash',
    differ = NOOP_DIFFER,
    mergeAllBranches = () => null,
    migrate,
    docCache,
  }: Partial<TrimergeClientOptions<any, any, any, any, any>> = {},
  updateStore?: (commits: any[], presence: any) => Promise<void>,
): {
  client: TrimergeClient<any, any, any, any, any>;
  onEvent: OnStoreEventFn<any, any, any>;
} {
  let onEvent: OnStoreEventFn<any, any, any> | undefined;
  const client = new TrimergeClient('', '', {
    computeRef,
    differ,
    migrate,
    mergeAllBranches,
    getLocalStore: (userId, clientId, _onEvent) => {
      onEvent = _onEvent;
      return {
        update: updateStore ?? (() => Promise.resolve()),
        shutdown: () => undefined,
        isRemoteLeader: false,
      };
    },
    addNewCommitMetadata,
    docCache,
  });
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
    void client.updateDoc('hello', 'hi');
    expect(client.getCommit('hash')).toMatchInlineSnapshot(`
      {
        "baseRef": undefined,
        "delta": null,
        "metadata": {
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

  it('merges metadata from server', async () => {
    const { client, onEvent } = makeTrimergeClient(
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
    void client.updateDoc('hello', 'hi');

    expect(client.getCommit('hash')).toMatchInlineSnapshot(`
      {
        "baseRef": undefined,
        "delta": null,
        "metadata": {
          "added": "on client",
          "clientId": "",
          "commitRef": "hash",
          "message": "hi",
          "userId": "",
        },
        "ref": "hash",
      }
    `);
    onEvent(
      {
        type: 'commits',
        commits: [
          {
            ref: 'hash',
            delta: null,
            metadata: {
              added: 'on server',
              main: true,
            },
          },
        ],
      },
      true,
    );

    expect(client.getCommit('hash')).toMatchInlineSnapshot(`
      {
        "delta": null,
        "metadata": {
          "added": "on server",
          "clientId": "",
          "commitRef": "hash",
          "main": true,
          "message": "hi",
          "userId": "",
        },
        "ref": "hash",
      }
    `);
  });

  it('handles bad getCommit', async () => {
    const { client } = makeTrimergeClient();
    void client.updateDoc('hello', 'hi');
    void client.updateDoc('hello2', 'hi');
    void client.updateDoc('hello3', 'hi');
    expect(client.getCommit('hash')).toMatchInlineSnapshot(`
      {
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
    ).toThrowErrorMatchingInlineSnapshot(
      `"no way to resolve a: no cached doc for a and no cached doc or commit for unknown"`,
    );
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

  it('preserves object references from client', async () => {
    const { client } = makeTrimergeClient(undefined, {
      differ: JDP_DIFFER,
      computeRef,
    });

    const nestedObject = {
      field: 'value',
    };

    const doc = {
      nested: nestedObject,
    };

    void client.updateDoc(doc, 'message');

    const array = [1, 2, 3];

    const doc2 = {
      nested: nestedObject,
      array,
    };

    void client.updateDoc(doc2, 'message');

    expect(client.doc.array).toBe(array);
    expect(client.doc.nested).toBe(nestedObject);
  });

  it('rejects if commits failed to store', async () => {
    const { client } = makeTrimergeClient(undefined, {}, () =>
      Promise.reject(
        new Error("Not a real error. Don't worry. It's only a test."),
      ),
    );

    await expect(
      client.updateDoc({ foo: 'bar' }, 'message'),
    ).rejects.toThrowError(/Not a real error/);
  });

  it('throws if there is an invalid number of commits', async () => {
    const { client } = makeTrimergeClient(undefined);

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore: accessing private field
    client.numPendingUpdates = -1;

    await expect(
      client.updateDoc({ foo: 'bar' }, 'message'),
    ).rejects.toThrowError(/Assertion Error: numUnsavedCommits <= 0/);
  });

  it('does not update local save status for presence-only updates', async () => {
    const { client } = makeTrimergeClient(undefined);

    const syncUpdates1: SyncStatus[] = [];
    client.subscribeSyncStatus((state) => syncUpdates1.push(state));

    expect(client.updatePresence({ foo: 'bar' }));

    expect(syncUpdates1).toMatchInlineSnapshot(`
      [
        {
          "localRead": "loading",
          "localSave": "ready",
          "remoteConnect": "offline",
          "remoteRead": "loading",
          "remoteSave": "ready",
        },
      ]
    `);
  });

  it('it can reference pre-hydrated documents from doc cache', () => {
    const testDocCache = new InMemoryDocCache<string, string>();
    const { client, onEvent: sendLocalStoreEvent } = makeTrimergeClient(
      undefined,
      { docCache: testDocCache, differ: JDP_DIFFER },
    );

    const snapshotDoc = 'hello';
    const commitOnTopOfSnapshotDoc = 'hello world';
    const delta = JDP_DIFFER.diff(snapshotDoc, commitOnTopOfSnapshotDoc);

    testDocCache.set('test-base-ref', {
      ref: 'test-base-ref',
      doc: 'hello',
      metadata: 'testSnapshotDocValue',
    });

    sendLocalStoreEvent(
      {
        type: 'commits',
        commits: [
          {
            baseRef: 'test-base-ref',
            ref: 'test-ref',
            delta,
            metadata: 'testCommitOnTopOfSnapshotDocValue',
          },
        ],
      },
      true,
    );

    expect(client.doc).toEqual(commitOnTopOfSnapshotDoc);
  });

  it('allows missing baseref, if doc exists in doc cache', () => {
    const testDocCache = new InMemoryDocCache<string, string>();
    const { client, onEvent: sendLocalStoreEvent } = makeTrimergeClient(
      undefined,
      { docCache: testDocCache, differ: JDP_DIFFER },
    );

    const unknownBaseDocument = 'hello';
    const docWithUnknownBaseRef = 'hello world';
    const delta = JDP_DIFFER.diff(unknownBaseDocument, docWithUnknownBaseRef);

    testDocCache.set('test-ref', {
      ref: 'test-ref',
      doc: docWithUnknownBaseRef,
      metadata: 'testCommitOnTopOfSnapshotDocValue',
    });

    sendLocalStoreEvent(
      {
        type: 'commits',
        commits: [
          {
            baseRef: 'test-base-ref',
            ref: 'test-ref',
            delta,
            metadata: 'testCommitOnTopOfSnapshotDocValue',
          },
        ],
      },
      true,
    );

    expect(client.doc).toEqual(docWithUnknownBaseRef);
  });

  it('it does not fail on a missing a merge ref', () => {
    const testDocCache = new InMemoryDocCache<string, string>();
    const { client, onEvent: sendLocalStoreEvent } = makeTrimergeClient(
      undefined,
      { docCache: testDocCache, differ: JDP_DIFFER },
    );

    const snapshotDoc = 'hello';
    const commitOnTopOfSnapshotDoc = 'hello world';
    const delta = JDP_DIFFER.diff(snapshotDoc, commitOnTopOfSnapshotDoc);

    testDocCache.set('test-base-ref', {
      ref: 'test-base-ref',
      doc: 'hello',
      metadata: 'testSnapshotDocValue',
    });

    sendLocalStoreEvent(
      {
        type: 'commits',
        commits: [
          {
            baseRef: 'test-base-ref',
            mergeRef: 'test-merge-ref',
            ref: 'test-ref',
            delta,
            metadata: 'testCommitOnTopOfSnapshotDocValue',
          },
        ],
      },
      true,
    );

    expect(client.doc).toEqual(commitOnTopOfSnapshotDoc);
  });
});
