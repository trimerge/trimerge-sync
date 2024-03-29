import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { MemoryStore } from './testLib/MemoryStore';
import { timeout } from './lib/Timeout';
import {
  TEST_OPTS,
  TestDoc,
  TestPresence,
  TestSavedDoc,
} from './testLib/MergeUtils';

type TestMetadata = any;

jest.setTimeout(10_000);

function newStore() {
  return new MemoryStore<TestMetadata, Delta, TestPresence>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<TestSavedDoc, TestDoc, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', {
    ...TEST_OPTS,
    getLocalStore: store.getLocalStore,
  });
}

describe('TrimergeClient Fuzz', () => {
  it('simultaneous edit', async () => {
    const store = newStore();
    const clientA = makeClient('a', store);
    const clientB = makeClient('b', store);
    const clientC = makeClient('c', store);

    void clientA.updateDoc('', { ref: 'ROOT', message: 'init' });

    await timeout();

    expect(clientA.doc).toEqual('');
    expect(clientB.doc).toEqual('');
    expect(clientC.doc).toEqual('');
    let aCount = 0;
    let bCount = 0;
    let cCount = 0;

    for (let i = 0; i < 1000; i++) {
      switch (Math.floor(Math.random() * 4)) {
        case 0:
          void clientA.updateDoc(clientA.doc + 'A', '');
          aCount++;
          break;
        case 1:
          void clientB.updateDoc(clientB.doc + 'B', '');
          bCount++;
          break;
        case 2:
          void clientC.updateDoc(clientC.doc + 'C', '');
          cCount++;
          break;
        case 3:
          await timeout();
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
