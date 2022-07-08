import { Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { MemoryStore } from './testLib/MemoryStore';
import {
  computeRef,
  diff,
  mergeAllBranches,
  patch,
} from './testLib/MergeUtils';
import { getBasicGraph } from './testLib/GraphVisualizers';
import { timeout } from './lib/Timeout';

type TestMetadata = string;
type DocV1 = { v: 1; field: number };
type DocV2 = { v: 2; field: string };
type TestPresence = any;

function newStore() {
  return new MemoryStore<TestMetadata, Delta, TestPresence>();
}

function makeClientV1(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<DocV1, DocV1, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', store.getLocalStore, {
    migrate: (doc, metadata) => ({ doc, metadata }),
    diff,
    patch: (priorOrNext, delta) => patch(priorOrNext as any, delta),
    computeRef,
    mergeAllBranches,
  });
}
function makeClientV2(
  userId: string,
  store: MemoryStore<TestMetadata, Delta, TestPresence>,
): TrimergeClient<DocV1 | DocV2, DocV2, TestMetadata, Delta, TestPresence> {
  return new TrimergeClient(userId, 'test', store.getLocalStore, {
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
    diff,
    patch: (priorOrNext, delta) => patch(priorOrNext as any, delta),
    computeRef,
    mergeAllBranches,
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
    client1.updateDoc({ v: 1, field: 123 }, 'initialize');
    expect(client1.doc).toEqual({ v: 1, field: 123 });

    await timeout();

    expect(basicGraph(store, client1)).toMatchInlineSnapshot(`Array []`);

    const client2 = makeClientV2('a', store);

    await timeout();

    expect(client2.doc).toEqual({ v: 2, field: '123' });

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> wkRuq_cr",
    "step": "initialize",
    "value": Object {
      "field": 123,
      "v": 1,
    },
  },
]
`);

    client2.updateDoc({ v: 2, field: '456' }, 'update field');
    expect(client2.doc).toEqual({ v: 2, field: '456' });

    await timeout();

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> wkRuq_cr",
    "step": "initialize",
    "value": Object {
      "field": 123,
      "v": 1,
    },
  },
  Object {
    "graph": "wkRuq_cr -> -gOdQHo5",
    "step": "migrated to v2",
    "value": Object {
      "field": "123",
      "v": 2,
    },
  },
  Object {
    "graph": "-gOdQHo5 -> nr3tJSIE",
    "step": "update field",
    "value": Object {
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
    client1.updateDoc({ v: 1, field: 123 }, 'initialize');
    expect(client1.doc).toEqual({ v: 1, field: 123 });

    await timeout();

    const client2 = makeClientV2('a', store);

    await timeout();

    expect(client2.doc).toEqual({ v: 2, field: '123' });

    client1.updateDoc({ v: 1, field: 456 }, 'update field');

    expect(client1.doc).toEqual({ v: 1, field: 456 });

    await timeout();

    // expect(client2.doc).toEqual({ v: 2, field: '456' });

    await timeout();

    expect(basicGraph(store, client2)).toMatchInlineSnapshot(`
Array [
  Object {
    "graph": "undefined -> wkRuq_cr",
    "step": "initialize",
    "value": Object {
      "field": 123,
      "v": 1,
    },
  },
  Object {
    "graph": "wkRuq_cr -> _AA1V6TC",
    "step": "update field",
    "value": Object {
      "field": 456,
      "v": 1,
    },
  },
]
`);
  });
});
