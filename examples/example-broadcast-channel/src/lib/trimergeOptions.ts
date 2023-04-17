// Basic trimerge function that merges values, strings, and objects
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import {
  CoordinatingLocalStore,
  GetLocalStoreFn,
  makeMergeAllBranchesFn,
  MergeAllBranchesFn,
  MergeDocFn,
} from 'trimerge-sync';
import { create, Delta } from 'jsondiffpatch';
import { produce } from 'immer';
import { trimergeNumber } from './trimergeNumber';
import { IndexedDbCommitRepository } from 'trimerge-sync-indexed-db';
import { WebsocketRemote } from 'trimerge-sync-basic-client';
import { randomId } from './randomId';

const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
  trimergeNumber,
);

export const merge: MergeDocFn<any, string> = (base, left, right) => ({
  doc: trimergeObjects(base?.doc, left.doc, right.doc),
  metadata: `merge`,
});

export const mergeAllBranches: MergeAllBranchesFn<any, any> =
  makeMergeAllBranchesFn((a, b) => (a < b ? -1 : 1), merge);

const jdp = create({ textDiff: { minLength: 20 } });

export function patch<T>(base: T, delta: Delta | undefined): T {
  if (delta === undefined) {
    return base;
  }
  return produce(base, (draft) => jdp.patch(draft, delta));
}

export const diff = <T extends any>(left: T, right: T): Delta | undefined =>
  jdp.diff(left, right);

export function createLocalStoreFactory(
  docId: string,
): GetLocalStoreFn<any, any, any> {
  return (userId, clientId, onEvent) => {
    const store = new CoordinatingLocalStore(userId, clientId, randomId(), {
      onStoreEvent: onEvent,
      commitRepo: new IndexedDbCommitRepository(docId, {
        localIdGenerator: randomId,
        remoteId: 'localhost',
      }),
      getRemote: (userId, localStoreId, lastSyncInfo, onEvent) =>
        new WebsocketRemote(
          { userId, readonly: false },
          localStoreId,
          lastSyncInfo,
          onEvent,
          `ws://localhost:4444/${encodeURIComponent(docId)}`,
        ),
      localChannel: {
        onEvent: () => {},
        sendEvent: () => {},
        shutdown: () => {},
      },
    });
    return store;
  };
}
