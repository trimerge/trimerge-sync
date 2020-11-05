import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { TrimergeMemoryStore } from './trimerge-memory-store';
import Jssha from 'jssha';
import { create } from 'jsondiffpatch';
import { MergeStateFn, TrimergeClient } from './trimerge-client';

// Basic trimerge function that merges values, strings, and objects
const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);

const mergeHeadsFn: MergeStateFn<any, string> = (base, left, right) => ({
  value: trimergeObjects(base?.value, left.value, right.value),
  editMetadata: `merge`,
});

function refHash(
  baseRef: string | undefined,
  baseRef2: string | undefined,
  delta: any,
  editMetadata: any,
): string {
  const sha = new Jssha('SHA-256', 'TEXT', { encoding: 'UTF8' });
  sha.update(JSON.stringify([baseRef, baseRef2, delta, editMetadata]));
  return sha.getHash('HEX');
}

const jdp = create({ textDiff: { minLength: 20 } });

function newStore() {
  return new TrimergeMemoryStore<any, string, any>(
    (left, right) => jdp.diff(left, right),
    (prior, delta) => jdp.patch(prior, delta),
    (next, delta) => {
      delta = jdp.reverse(delta);
      return delta !== undefined ? jdp.patch(next, delta) : next;
    },
    refHash,
  );
}

function makeClient(store: TrimergeMemoryStore<any, string, any>) {
  return TrimergeClient.create(store, mergeHeadsFn, 0);
}

describe('client.mergeHeads()', () => {
  it('"merges" single node', async () => {
    const store = newStore();
    const client = await makeClient(store);

    client.editState({}, 'initialize');
    client.editState({ hello: 'world' }, 'add hello');
    client.editState({ hello: 'vorld' }, 'change hello');

    expect(client.state).toEqual({ hello: 'vorld' });
  });

  it('editing with multiple clients', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

    // No values
    expect(client1.state).toBe(undefined);
    expect(client2.state).toBe(undefined);

    client1.editState({}, 'initialize');

    // Client 1 is updated, but not client2
    expect(client1.state).toEqual({});
    expect(client2.state).toBe(undefined);

    await client1.sync();
    await client2.sync();

    // Client2 is updated now
    expect(client1.state).toEqual({});
    expect(client2.state).toEqual({});

    client1.editState({ hello: 'world' }, 'add hello');
    client1.editState({ hello: 'vorld' }, 'change hello');

    // Client 1 is updated, but not client 2
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({});

    await client1.sync();
    await client2.sync();

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    client2.editState({ hello: 'vorld', world: 'world' }, 'add world');
    client2.editState({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await client1.sync();
    await client2.sync();

    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('merges v split', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

    client1.editState({}, 'initialize');

    await client1.sync();

    // Synchronized
    expect(client1.state).toEqual({});
    expect(client2.state).toEqual({});

    client1.editState({ hello: 'world' }, 'add hello');
    client1.editState({ hello: 'vorld' }, 'change hello');

    client2.editState({ world: 'world' }, 'add world');
    client2.editState({ world: 'vorld' }, 'change world');

    // Now client 1 and client 2 have different changes
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ world: 'vorld' });

    await client1.sync();
    await client2.sync();

    //  Now they should both have trimerged changes
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await client1.sync();
    await client2.sync();

    // Should be the same
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });
});
