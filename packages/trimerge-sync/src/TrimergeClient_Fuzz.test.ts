import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import {
  computeRef,
  diff,
  mergeAllBranches,
  migrate,
  patch,
} from './testLib/MergeUtils';
import { timeout } from './lib/Timeout';
import { isMergeCommit } from './types';

jest.setTimeout(10_000);

type TestMetadata = any;
type TestSavedDoc = any;
type TestDoc = any;
type TestPresence = any;

const differ: Differ<TestSavedDoc, TestDoc, TestMetadata, TestPresence> = {
  migrate,
  diff,
  patch,
  computeRef,
  mergeAllBranches,
};

function newStore(remote?: MemoryStore<TestMetadata, Delta, TestPresence>) {
  return new MemoryStore<TestMetadata, Delta, TestPresence>(
    undefined,
    remote?.getRemote,
  );
}

function makeClient(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<TestSavedDoc, TestDoc, TestMetadata, Delta, TestPresence> {
  const newClient = new TrimergeClient(userId, 'test', store.getLocalStore, {
    ...differ,
    headFilter: (ref: string) => {
      const commit = newClient.getCommit(ref);
      if (
        isMergeCommit(commit) &&
        commit.metadata.main !== undefined &&
        !commit.metadata.main
      ) {
        return false;
      }
      return true;
    },
  });
  return newClient;
}

describe('TrimergeClient Fuzz', () => {
  it('simultaneous edit', async () => {
    const remoteStore = newStore();
    const storeA = newStore(remoteStore);
    const storeB = newStore(remoteStore);
    const storeC = newStore(remoteStore);
    const clientA = makeClient('a', storeA);
    const clientB = makeClient('b', storeB);
    const clientC = makeClient('c', storeC);

    void clientA.updateDoc('', { ref: 'ROOT', message: 'init' });

    await timeout();

    expect(clientA.doc).toEqual('');
    expect(clientB.doc).toEqual('');
    expect(clientC.doc).toEqual('');
    let aCount = 0;
    let bCount = 0;
    let cCount = 0;

    for (let i = 0; i < 10; i++) {
      switch (Math.floor(Math.random() * 4)) {
        case 0:
          void clientA.updateDoc(clientA.doc + 'A', { message: '' });
          aCount++;
          break;
        case 1:
          void clientB.updateDoc(clientB.doc + 'B', { message: '' });
          bCount++;
          break;
        case 2:
          void clientC.updateDoc(clientC.doc + 'C', { message: '' });
          cCount++;
          break;
        case 3:
          await timeout(10);
          break;
      }
    }
    await timeout(100);
    // Synchronized
    expect(clientA.doc).toEqual(clientB.doc);
    expect(clientA.doc).toEqual(clientC.doc);

    let aCount2 = 0;
    let bCount2 = 0;
    let cCount2 = 0;
    for (const letter of clientA.doc) {
      switch (letter) {
        case 'A':
          aCount2++;
          break;
        case 'B':
          bCount2++;
          break;
        case 'C':
          cCount2++;
          break;
      }
    }
    expect(aCount2).toBe(aCount);
    expect(bCount2).toBe(bCount);
    expect(cCount2).toBe(cCount);
  });
});
