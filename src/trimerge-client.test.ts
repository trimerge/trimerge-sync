import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { TrimergeMemoryStore } from './trimerge-memory-store';
import Jssha from 'jssha';
import { create, Delta } from 'jsondiffpatch';
import { MergeStateFn, TrimergeClient } from './trimerge-client';
import { produce } from 'immer';

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

function immerPatch<T>(base: T, delta: Delta | undefined): T {
  if (delta === undefined) {
    return base;
  }
  return produce(base, (draft) => jdp.patch(draft, delta));
}

function newStore() {
  return new TrimergeMemoryStore<any, string, any>(
    (left, right) => jdp.diff(left, right),
    immerPatch,
    (next, delta) => immerPatch(next, jdp.reverse(delta)),
    refHash,
  );
}

function makeClient(
  store: TrimergeMemoryStore<any, string, any>,
): Promise<TrimergeClient<any, string, any>> {
  return TrimergeClient.create(store, mergeHeadsFn, 0);
}

function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
describe('TrimergeClient', () => {
  it('tracks edits', async () => {
    const store = newStore();
    const client = await makeClient(store);

    client.editState({}, 'initialize');
    client.editState({ hello: 'world' }, 'add hello');
    client.editState({ hello: 'vorld' }, 'change hello');

    expect(client.state).toEqual({ hello: 'vorld' });
  });

  it('edit syncs across two clients', async () => {
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

    await timeout();

    // Client2 is updated now
    expect(client1.state).toEqual({});
    expect(client2.state).toEqual({});
  });

  it('two edits sync across two clients', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

    client1.editState({}, 'initialize');
    client1.editState({ edit: true }, 'edit');

    // Client 1 is updated, but not client2
    expect(client1.state).toEqual({ edit: true });
    expect(client2.state).toBe(undefined);

    await timeout();

    expect(client2.state).toEqual({ edit: true });
  });

  it('edit syncs back and forth with two clients', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

    client1.editState({}, 'initialize');
    client1.editState({ hello: 'world' }, 'add hello');
    client1.editState({ hello: 'vorld' }, 'change hello');

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    client2.editState({ hello: 'vorld', world: 'world' }, 'add world');
    client2.editState({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('automatic merging if two clients edit simultaneously', async () => {
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

    await timeout();

    //  Now they should both have trimerged changes
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    // Should be the same
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('sync up when second client comes in later', async () => {
    const store = newStore();
    const client1 = await makeClient(store);

    client1.editState({}, 'initialize');
    client1.editState({ hello: 'world' }, 'add hello');
    client1.editState({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = await makeClient(store);

    // client 2 starts out synced
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });
  });

  it('first two clients conflict, then third one joins', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

    client1.editState({}, 'initialize');

    await client1.sync();
    client1.editState({ hello: 'world' }, 'add hello');
    client1.editState({ hello: 'vorld' }, 'change hello');
    client2.editState({ world: 'world' }, 'add world');
    client2.editState({ world: 'vorld' }, 'change world');

    // Now client 1 and client 2 have different changes
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ world: 'vorld' });

    const client3 = await makeClient(store);
    expect(client3.state).toEqual({});

    await timeout();

    //  Now they should all have the trimerged state
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client3.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });
});
