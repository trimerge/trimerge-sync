import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { MemoryStore } from './testLib/MemoryStore';
import { diff, patch, TestPresence, TEST_OPTS } from './testLib/MergeUtils';
import { getBasicGraph } from './lib/GraphVisualizers';
import { timeout } from './lib/Timeout';
import { TrimergeClientOptions } from './TrimergeClientOptions';

type TestMetadata = string;
type DocV1 = { v: 1; field: number };
type DocV2 = { v: 2; field: string };

function newStore() {
  return new MemoryStore<TestMetadata, Delta, TestPresence>();
}

const migrationOpts: Pick<
  TrimergeClientOptions<any, any, TestMetadata, Delta, TestPresence>,
  'differ' | 'computeRef' | 'mergeAllBranches'
> = {
  ...TEST_OPTS,
  differ: {
    diff,
    patch: (priorOrNext, delta) => patch(priorOrNext as any, delta),
  },
};

function makeClientV1(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<DocV1, DocV1, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', {
    ...migrationOpts,
    getLocalStore: store.getLocalStore,
  });
}
function makeClientV2(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<DocV1 | DocV2, DocV2, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient<
    DocV1 | DocV2,
    DocV2,
    TestMetadata,
    Delta,
    TestPresence
  >(userId, 'test', {
    ...migrationOpts,
    getLocalStore: store.getLocalStore,
    migrate: (doc, metadata) => {
      switch (doc.v) {
        case 1:
          return {
            doc: { v: 2, field: String(doc.field) },
            metadata: 'migrated to v2',
          };
        case 2:
          return { doc, metadata };
      }
    },
  });
}

function makeNonReferenceEqualMigrationClient(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<DocV1, DocV1, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', {
    ...TEST_OPTS,
    getLocalStore: store.getLocalStore,
    migrate: (doc, metadata) => {
      return { doc: { ...doc }, metadata };
    },
  });
}

function basicGraph(
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
  client1: TrimergeClient<any, any, any, any, any>,
) {
  return getBasicGraph(
    store.getCommits(),
    (commit) => commit.metadata,
    (commit) => client1.getCommitDoc(commit.ref).doc,
  );
}

describe('TrimergeClient: Migration', () => {
  it('migrates from one version to another', async () => {
    const store = newStore();

    const client1 = makeClientV1('a', store);
    void client1.updateDoc({ v: 1, field: 123 }, 'initialize');
    expect(client1.doc).toEqual({ v: 1, field: 123 });

    await timeout();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> wkRuq_cr",
          "step": "initialize",
          "value": {
            "field": 123,
            "v": 1,
          },
        },
      ]
    `);

    const client2 = makeClientV2('a', store);

    await timeout();

    expect(client2.doc).toEqual({ v: 2, field: '123' });

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> wkRuq_cr",
          "step": "initialize",
          "value": {
            "field": 123,
            "v": 1,
          },
        },
      ]
    `);

    void client2.updateDoc({ v: 2, field: '456' }, 'update field');
    expect(client2.doc).toEqual({ v: 2, field: '456' });

    await timeout();

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> wkRuq_cr",
          "step": "initialize",
          "value": {
            "field": 123,
            "v": 1,
          },
        },
        {
          "graph": "wkRuq_cr -> -gOdQHo5",
          "step": "migrated to v2",
          "value": {
            "field": "123",
            "v": 2,
          },
        },
        {
          "graph": "-gOdQHo5 -> nr3tJSIE",
          "step": "update field",
          "value": {
            "field": "456",
            "v": 2,
          },
        },
      ]
    `);
  });
  it('remigrates as updates come in', async () => {
    const store = newStore();

    const client1 = makeClientV1('a', store);
    void client1.updateDoc({ v: 1, field: 123 }, 'initialize');
    expect(client1.doc).toEqual({ v: 1, field: 123 });

    await timeout();

    const client2 = makeClientV2('a', store);

    await timeout();

    expect(client2.doc).toEqual({ v: 2, field: '123' });

    void client1.updateDoc({ v: 1, field: 456 }, 'update field');

    expect(client1.doc).toEqual({ v: 1, field: 456 });

    await timeout();

    // expect(client2.doc).toEqual({ v: 2, field: '456' });

    await timeout();

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
      [
        {
          "graph": "undefined -> wkRuq_cr",
          "step": "initialize",
          "value": {
            "field": 123,
            "v": 1,
          },
        },
        {
          "graph": "wkRuq_cr -> _AA1V6TC",
          "step": "update field",
          "value": {
            "field": 456,
            "v": 1,
          },
        },
      ]
    `);
  });

  it('doesnt make a commit for a noop migration commit', async () => {
    const store = newStore();

    const client1 = makeNonReferenceEqualMigrationClient('a', store);
    void client1.updateDoc({ v: 1, field: 123 }, 'initialize');
    expect(client1.doc).toEqual({ v: 1, field: 123 });

    void client1.updateDoc({ v: 1, field: 124 }, 'update field');
    await timeout();

    expect(store.getCommits()).toMatchInlineSnapshot(`
      [
        {
          "baseRef": undefined,
          "delta": [
            {
              "field": 123,
              "v": 1,
            },
          ],
          "metadata": "initialize",
          "ref": "wkRuq_cr",
        },
        {
          "baseRef": "wkRuq_cr",
          "delta": {
            "field": [
              123,
              124,
            ],
          },
          "metadata": "update field",
          "ref": "d7exbdh_",
        },
      ]
    `);
  });
});
