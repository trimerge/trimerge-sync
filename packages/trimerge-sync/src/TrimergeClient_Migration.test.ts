import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { MemoryStore } from './testLib/MemoryStore';
import { computeRef, diff, merge, patch } from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { timeout } from './lib/Timeout';

type TestEditMetadata = string;
type DocV1 = { v: 1; field: number };
type DocV2 = { v: 2; field: string };
type TestPresenceState = any;

function newStore() {
  return new MemoryStore<TestEditMetadata, Delta, TestPresenceState>();
}

function makeClientV1(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
): TrimergeClient<DocV1, DocV1, TestEditMetadata, Delta, TestPresenceState> {
  return new TrimergeClient(
    userId,
    'test',
    store.getLocalStore,
    {
      migrate: (state, editMetadata) => ({ state, editMetadata }),
      diff,
      patch: (priorOrNext, delta) => patch(priorOrNext as any, delta),
      computeRef,
      merge,
    },
    0,
  );
}
function makeClientV2(
  userId: string,
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
): TrimergeClient<
  DocV1 | DocV2,
  DocV2,
  TestEditMetadata,
  Delta,
  TestPresenceState
> {
  return new TrimergeClient(
    userId,
    'test',
    store.getLocalStore,
    {
      migrate: (state, editMetadata) => {
        switch (state.v) {
          case 1:
            return {
              state: { v: 2, field: String(state.field) },
              editMetadata: 'migrated to v2',
            };
          case 2:
            return { state, editMetadata };
        }
      },
      diff,
      patch: (priorOrNext, delta) => patch(priorOrNext as any, delta),
      computeRef,
      merge,
    },
    0,
  );
}

function basicGraph(
  store: MemoryStore<TestEditMetadata, Delta, TestPresenceState>,
  client1: TrimergeClient<any, any, any, any, any>,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.editMetadata,
    (commit) => client1.getCommitState(commit.ref).state,
  );
}

describe('TrimergeClient: Migration', () => {
  it('migrates from one version to another', async () => {
    const store = newStore();

    const client1 = makeClientV1('a', store);
    client1.updateState({ v: 1, field: 123 }, 'initialize');
    expect(client1.state).toEqual({ v: 1, field: 123 });

    await timeout();

    await client1.shutdown();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> Z-zhYWBg",
    "step": "User a: initialize",
    "value": Object {
      "field": 123,
      "v": 1,
    },
  },
]
`);

    const client2 = makeClientV2('a', store);

    await timeout();

    expect(client2.state).toEqual({ v: 2, field: '123' });

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> Z-zhYWBg",
    "step": "User a: initialize",
    "value": Object {
      "field": 123,
      "v": 1,
    },
  },
]
`);

    client2.updateState({ v: 2, field: '456' }, 'update field');
    expect(client2.state).toEqual({ v: 2, field: '456' });

    await timeout();

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> Z-zhYWBg",
    "step": "User a: initialize",
    "value": Object {
      "field": 123,
      "v": 1,
    },
  },
  Object {
    "graph": "Z-zhYWBg -> wjdpLZeO",
    "step": "User a: migrated to v2",
    "value": Object {
      "field": "123",
      "v": 2,
    },
  },
  Object {
    "graph": "wjdpLZeO -> UzG9E1u9",
    "step": "User a: update field",
    "value": Object {
      "field": "456",
      "v": 2,
    },
  },
]
`);

    await client2.shutdown();
  });
  it('handles promotion of lazy commit that comes in externally', async () => {
    const store = newStore();

    const client1 = makeClientV1('a', store);
    client1.updateState({ v: 1, field: 123 }, 'initialize');
    expect(client1.state).toEqual({ v: 1, field: 123 });

    await timeout();

    await client1.shutdown();

    const client2 = makeClientV2('a', store);
    const client3 = makeClientV2('b', store);

    await timeout();

    expect(client2.state).toEqual({ v: 2, field: '123' });
    expect(client3.state).toEqual({ v: 2, field: '123' });

    client2.updateState({ v: 2, field: '456' }, 'update field');

    await timeout();

    expect(client2.state).toEqual({ v: 2, field: '456' });
    expect(client3.state).toEqual({ v: 2, field: '456' });

    await client2.shutdown();
    await client3.shutdown();
  });
});
