import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { Differ } from './differ';
import { MemoryStore } from './testLib/MemoryStore';
import { computeRef, diff, merge, patch } from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { timeout } from './lib/Timeout';

type TestEditMetadata = any;
type TestState = any;
type TestPresenceState = any;

const differ: Differ<TestState, TestEditMetadata, TestPresenceState> = {
  diff,
  patch,
  computeRef,
  merge,
};

function newStore() {
  return new MemoryStore<TestEditMetadata, Delta, TestPresenceState>();
}

function makeClient(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestPresenceState> {
  return new TrimergeClient(userId, 'test', store.getLocalStore, differ);
}

describe('TrimergeClient Fuzz', () => {
  it('simultaneous edit', async () => {
    const store = newStore();
    const clientA = makeClient('a', store);
    const clientB = makeClient('b', store);
    const clientC = makeClient('c', store);

    clientA.updateState('', { ref: 'ROOT', message: 'init' });

    await timeout();

    expect(clientA.state).toEqual('');
    expect(clientB.state).toEqual('');
    expect(clientC.state).toEqual('');
    let aCount = 0;
    let bCount = 0;
    let cCount = 0;

    for (let i = 0; i < 1000; i++) {
      switch (Math.floor(Math.random() * 4)) {
        case 0:
          clientA.updateState(clientA.state + 'A', '');
          aCount++;
          break;
        case 1:
          clientB.updateState(clientB.state + 'B', '');
          bCount++;
          break;
        case 2:
          clientC.updateState(clientC.state + 'C', '');
          cCount++;
          break;
        case 3:
          await timeout();
          break;
      }
    }
    await timeout(100);
    // Synchronized
    expect(clientA.state).toEqual(clientB.state);
    expect(clientA.state).toEqual(clientC.state);

    let aCount2 = 0;
    let bCount2 = 0;
    let cCount2 = 0;
    for (const letter of clientA.state) {
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
