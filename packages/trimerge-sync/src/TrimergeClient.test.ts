import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { computeRef } from 'trimerge-sync-hash';
import { create, Delta } from 'jsondiffpatch';
import { TrimergeClient } from './TrimergeClient';
import { produce } from 'immer';
import { Differ, MergeStateFn } from './differ';
import { TestMemoryStore } from './TestMemoryStore';

// Basic trimerge function that merges values, strings, and objects
const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);

type TestEditMetadata = string;
type TestState = any;
type TestCursorData = any;

const merge: MergeStateFn<TestState, TestEditMetadata> = (
  base,
  left,
  right,
) => ({
  value: trimergeObjects(base?.value, left.value, right.value),
  editMetadata: `merge`,
});

const jdp = create({ textDiff: { minLength: 20 } });

function patch<T>(base: T, delta: Delta | undefined): T {
  if (delta === undefined) {
    return base;
  }
  return produce(base, (draft) => jdp.patch(draft, delta));
}

const differ: Differ<TestState, TestEditMetadata, TestCursorData> = {
  normalize: (state) => [state, 'normalize'],
  diff: (left, right) => jdp.diff(left, right),
  patch,
  computeRef,
  merge,
};

function newStore() {
  return new TestMemoryStore<TestEditMetadata, Delta, TestCursorData>();
}

function makeClient(
  cursorId: string,
  store: TestMemoryStore<TestEditMetadata, Delta, TestCursorData>,
): TrimergeClient<TestState, TestEditMetadata, Delta, TestCursorData> {
  return new TrimergeClient('test', cursorId, store.getSyncBackend, differ, 0);
}

function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
describe('TrimergeClient', () => {
  it('tracks edits', async () => {
    const store = newStore();
    const client = makeClient('a', store);

    client.addEdit({}, 'initialize');
    client.addEdit({ hello: 'world' }, 'add hello');
    client.addEdit({ hello: 'vorld' }, 'change hello');

    expect(client.state).toEqual({ hello: 'vorld' });
  });

  it('edit syncs across two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    // No values
    expect(client1.state).toBe(undefined);
    expect(client2.state).toBe(undefined);

    client1.addEdit({}, 'initialize');

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
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ edit: true }, 'edit');

    // Client 1 is updated, but not client2
    expect(client1.state).toEqual({ edit: true });
    expect(client2.state).toBe(undefined);

    await timeout();

    expect(client2.state).toEqual({ edit: true });
  });

  it('edit syncs back and forth with two clients', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    client2.addEdit({ hello: 'vorld', world: 'world' }, 'add world');
    client2.addEdit({ hello: 'vorld', world: 'vorld' }, 'change world');

    // Now client 2 is updated but not client 1
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });

    await timeout();

    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('automatic merging if two clients edit simultaneously', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');

    await client1.sync();

    // Synchronized
    expect(client1.state).toEqual({});
    expect(client2.state).toEqual({});

    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    client2.addEdit({ world: 'world' }, 'add world');
    client2.addEdit({ world: 'vorld' }, 'change world');

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

    client1.shutdown();
    client2.shutdown();
  });

  it('automatic merging if three clients edit simultaneously', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);
    const client3 = makeClient('c', store);

    client1.addEdit({ text: '' }, 'initialize');

    await client1.sync();

    // Synchronized
    expect(client1.state).toEqual({ text: '' });
    expect(client2.state).toEqual({ text: '' });
    expect(client3.state).toEqual({ text: '' });

    client1.addEdit({ text: 'a' }, 'set text');
    client2.addEdit({ text: 'b' }, 'set text');
    client3.addEdit({ text: 'c' }, 'set text');

    // Now client 1 and client 2 have different changes
    expect(client1.state).toEqual({ text: 'a' });
    expect(client2.state).toEqual({ text: 'b' });
    expect(client3.state).toEqual({ text: 'c' });

    await timeout();

    //  Now they should all have trimerged changes
    expect(client1.state).toEqual({ text: 'babc' });
    expect(client2.state).toEqual({ text: 'babc' });
    expect(client3.state).toEqual({ text: 'babc' });

    await client1.shutdown();
    await client2.shutdown();
    await client3.shutdown();

    expect(store.getNodes()).toMatchInlineSnapshot(`
      Array [
        Object {
          "baseRef": undefined,
          "cursorId": "a",
          "delta": undefined,
          "editMetadata": "normalize",
          "mergeRef": undefined,
          "ref": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "userId": "test",
        },
        Object {
          "baseRef": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "cursorId": "a",
          "delta": Array [
            Object {
              "text": "",
            },
          ],
          "editMetadata": "initialize",
          "mergeRef": undefined,
          "ref": "I8GtVLAH0oGCEkH_5qikLxEHrkBZRwMD1vaBbbG8oQQ",
          "userId": "test",
        },
        Object {
          "baseRef": undefined,
          "cursorId": "b",
          "delta": undefined,
          "editMetadata": "normalize",
          "mergeRef": undefined,
          "ref": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "userId": "test",
        },
        Object {
          "baseRef": "I8GtVLAH0oGCEkH_5qikLxEHrkBZRwMD1vaBbbG8oQQ",
          "cursorId": "b",
          "delta": Object {
            "text": Array [
              "",
              "b",
            ],
          },
          "editMetadata": "set text",
          "mergeRef": undefined,
          "ref": "YUoxjetj8VbS-DFIZ_CbiawH4t6zRGvHP1Qm5SFttSc",
          "userId": "test",
        },
        Object {
          "baseRef": undefined,
          "cursorId": "c",
          "delta": undefined,
          "editMetadata": "normalize",
          "mergeRef": undefined,
          "ref": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "userId": "test",
        },
        Object {
          "baseRef": "I8GtVLAH0oGCEkH_5qikLxEHrkBZRwMD1vaBbbG8oQQ",
          "cursorId": "c",
          "delta": Object {
            "text": Array [
              "",
              "c",
            ],
          },
          "editMetadata": "set text",
          "mergeRef": undefined,
          "ref": "ijUBwkeAVJkd0ZGFyYujp_F-MfjShL4-J3ao79S7ng8",
          "userId": "test",
        },
        Object {
          "baseRef": "YUoxjetj8VbS-DFIZ_CbiawH4t6zRGvHP1Qm5SFttSc",
          "cursorId": "c",
          "delta": Object {
            "text": Array [
              "b",
              "bc",
            ],
          },
          "editMetadata": "merge",
          "mergeRef": "ijUBwkeAVJkd0ZGFyYujp_F-MfjShL4-J3ao79S7ng8",
          "ref": "EXjoUwlYuclPDHHYeIjlbgJqAfY5-jtUw7sVcroXZVg",
          "userId": "test",
        },
        Object {
          "baseRef": "EXjoUwlYuclPDHHYeIjlbgJqAfY5-jtUw7sVcroXZVg",
          "cursorId": "c",
          "delta": undefined,
          "editMetadata": "merge",
          "mergeRef": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "ref": "ZRHpbAGGDflQ-aNYsp5fWPCoEVm-XCr50IjRycTrHlI",
          "userId": "test",
        },
        Object {
          "baseRef": "I8GtVLAH0oGCEkH_5qikLxEHrkBZRwMD1vaBbbG8oQQ",
          "cursorId": "a",
          "delta": Object {
            "text": Array [
              "",
              "a",
            ],
          },
          "editMetadata": "set text",
          "mergeRef": undefined,
          "ref": "_61Fa_p0XjaOcPbu_4HWjS2M4h-Dr_lTEu86Q_IHjdg",
          "userId": "test",
        },
        Object {
          "baseRef": "YUoxjetj8VbS-DFIZ_CbiawH4t6zRGvHP1Qm5SFttSc",
          "cursorId": "a",
          "delta": Object {
            "text": Array [
              "b",
              "ba",
            ],
          },
          "editMetadata": "merge",
          "mergeRef": "_61Fa_p0XjaOcPbu_4HWjS2M4h-Dr_lTEu86Q_IHjdg",
          "ref": "OQZRNaE9ZYnoQENtyzXFFt3eZ6QF-YM9ZNSSW6ykZJ0",
          "userId": "test",
        },
        Object {
          "baseRef": "OQZRNaE9ZYnoQENtyzXFFt3eZ6QF-YM9ZNSSW6ykZJ0",
          "cursorId": "a",
          "delta": undefined,
          "editMetadata": "merge",
          "mergeRef": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "ref": "PPSidNymXAjsOIdWi_zQq-_xVNcDHy-iZWLqknvrewk",
          "userId": "test",
        },
        Object {
          "baseRef": "PPSidNymXAjsOIdWi_zQq-_xVNcDHy-iZWLqknvrewk",
          "cursorId": "a",
          "delta": Object {
            "text": Array [
              "ba",
              "babc",
            ],
          },
          "editMetadata": "merge",
          "mergeRef": "ZRHpbAGGDflQ-aNYsp5fWPCoEVm-XCr50IjRycTrHlI",
          "ref": "DappAPCNNQfp2Lb_2cW__gAIksc4fmBIQYFlxXg30Yg",
          "userId": "test",
        },
      ]
    `);
  });

  it('sync up when second client comes in later', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual(undefined);
    await timeout();
    expect(client2.state).toEqual({ hello: 'vorld' });
  });

  it('subscription works', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const subscribeFn = jest.fn();

    const unsubscribeFn = client1.subscribe(subscribeFn);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = makeClient('b', store);

    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual(undefined);

    await timeout();

    client1.addEdit({ hello: 'there' }, 'change hello again');

    await timeout();

    unsubscribeFn();

    expect(subscribeFn.mock.calls).toEqual([
      [undefined],
      [{}],
      [{ hello: 'world' }],
      [{ hello: 'vorld' }],
      [{ hello: 'there' }],
    ]);
  });

  it('first two clients conflict, then third one joins', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);
    const client2 = makeClient('b', store);

    client1.addEdit({}, 'initialize');

    await client1.sync();
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');
    client2.addEdit({ world: 'world' }, 'add world');
    client2.addEdit({ world: 'vorld' }, 'change world');

    // Now client 1 and client 2 have different changes
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ world: 'vorld' });

    const client3 = makeClient('c', store);
    expect(client3.state).toEqual(undefined);

    await timeout();

    //  Now they should all have the trimerged state
    expect(client1.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld', world: 'vorld' });
    expect(client3.state).toEqual({ hello: 'vorld', world: 'vorld' });
  });

  it('works with lots of character typing', async () => {
    const store = newStore();
    const client1 = makeClient('a', store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'world. t' }, 'typing');
    client1.addEdit({ hello: 'world. th' }, 'typing');
    client1.addEdit({ hello: 'world. thi' }, 'typing');
    client1.addEdit({ hello: 'world. this' }, 'typing');
    client1.addEdit({ hello: 'world. this ' }, 'typing');
    client1.addEdit({ hello: 'world. this i' }, 'typing');
    client1.addEdit({ hello: 'world. this is' }, 'typing');
    client1.addEdit({ hello: 'world. this is ' }, 'typing');
    client1.addEdit({ hello: 'world. this is a' }, 'typing');
    client1.addEdit({ hello: 'world. this is a t' }, 'typing');
    client1.addEdit({ hello: 'world. this is a te' }, 'typing');
    client1.addEdit({ hello: 'world. this is a tes' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test ' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test o' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of ' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of c' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of ch' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of cha' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of char' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of chara' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of charac' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of charact' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of characte' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of character' }, 'typing');
    client1.addEdit({ hello: 'world. this is a test of character.' }, 'typing');

    await timeout();

    expect(store.getNodes()).toMatchInlineSnapshot(`
      Array [
        Object {
          "baseRef": undefined,
          "cursorId": "a",
          "delta": undefined,
          "editMetadata": "normalize",
          "mergeRef": undefined,
          "ref": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "userId": "test",
        },
        Object {
          "baseRef": "Zjb6U-4O69eXsiXh5qC7jFDxGbbx7SIcEan3_6MC3jE",
          "cursorId": "a",
          "delta": Array [
            Object {},
          ],
          "editMetadata": "initialize",
          "mergeRef": undefined,
          "ref": "sR6UhpAVdDk6k_bp_V2_NI09-2EF8JEnaEn2I3cbrh4",
          "userId": "test",
        },
        Object {
          "baseRef": "sR6UhpAVdDk6k_bp_V2_NI09-2EF8JEnaEn2I3cbrh4",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world",
            ],
          },
          "editMetadata": "add hello",
          "mergeRef": undefined,
          "ref": "QIGDUlAgE1OU7uVHEhN-H4xu9b3bsntdFjoZjYoawUw",
          "userId": "test",
        },
        Object {
          "baseRef": "QIGDUlAgE1OU7uVHEhN-H4xu9b3bsntdFjoZjYoawUw",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world",
              "world. t",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "6G4bOfXy5A3sqFsbhpfoEpxltl2RpoejzhBvQIfGDDU",
          "userId": "test",
        },
        Object {
          "baseRef": "6G4bOfXy5A3sqFsbhpfoEpxltl2RpoejzhBvQIfGDDU",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. t",
              "world. th",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "XqSUsu8XRagh2C1OON8CkgbicB8L_vc5K5BMBCIJtvg",
          "userId": "test",
        },
        Object {
          "baseRef": "XqSUsu8XRagh2C1OON8CkgbicB8L_vc5K5BMBCIJtvg",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. th",
              "world. thi",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "_ekjNBXqy2umRSRFpGMvOR6WGwXIaIuGdTJrd5Zn_-k",
          "userId": "test",
        },
        Object {
          "baseRef": "_ekjNBXqy2umRSRFpGMvOR6WGwXIaIuGdTJrd5Zn_-k",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. thi",
              "world. this",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "EDzjy8RvlfwtTE0tr2pkzO3DCN3Sr7eoShZjTYwx0As",
          "userId": "test",
        },
        Object {
          "baseRef": "EDzjy8RvlfwtTE0tr2pkzO3DCN3Sr7eoShZjTYwx0As",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this",
              "world. this ",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "XdLMr14SPL996frd_tm108WbkiOzEIoWtQ3fsNBXPY4",
          "userId": "test",
        },
        Object {
          "baseRef": "XdLMr14SPL996frd_tm108WbkiOzEIoWtQ3fsNBXPY4",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this ",
              "world. this i",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "Un_H1lzZ_V6YUSbyil4fkiaA-l5PXTfSqsK2vvVPENA",
          "userId": "test",
        },
        Object {
          "baseRef": "Un_H1lzZ_V6YUSbyil4fkiaA-l5PXTfSqsK2vvVPENA",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this i",
              "world. this is",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "jaC33SumjOuyFQXNudeMsP01BZT_HPeumBo6-bzCxhs",
          "userId": "test",
        },
        Object {
          "baseRef": "jaC33SumjOuyFQXNudeMsP01BZT_HPeumBo6-bzCxhs",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this is",
              "world. this is ",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "z9GrF5F4aGwcSMa-A-WlrrFQUR26JGejhiYUSA8lXAU",
          "userId": "test",
        },
        Object {
          "baseRef": "z9GrF5F4aGwcSMa-A-WlrrFQUR26JGejhiYUSA8lXAU",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this is ",
              "world. this is a",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "Yc0RDO-6DWg5dNgE2thDLXTBwrsDUH8i-PRUheXSlfo",
          "userId": "test",
        },
        Object {
          "baseRef": "Yc0RDO-6DWg5dNgE2thDLXTBwrsDUH8i-PRUheXSlfo",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this is a",
              "world. this is a t",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "2yPk0sBmhrPsy_aoZsKt2p3fGxvtXD3U-8DE3O5ytOQ",
          "userId": "test",
        },
        Object {
          "baseRef": "2yPk0sBmhrPsy_aoZsKt2p3fGxvtXD3U-8DE3O5ytOQ",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this is a t",
              "world. this is a te",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "SPGiu_EOR081ZUBz4CrRAm9m5ixLiqysf3Fu-wOIoY0",
          "userId": "test",
        },
        Object {
          "baseRef": "SPGiu_EOR081ZUBz4CrRAm9m5ixLiqysf3Fu-wOIoY0",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "world. this is a te",
              "world. this is a tes",
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "8wFwXdSf87NRHFtjeoG4_IYIP3gKxclUem_jwWHyz2A",
          "userId": "test",
        },
        Object {
          "baseRef": "8wFwXdSf87NRHFtjeoG4_IYIP3gKxclUem_jwWHyz2A",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -13,8 +13,9 @@
       is a tes
      +t
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "W6ycBb05K2cRoMcl2WuUu5B945expanGov3qdbBSQQQ",
          "userId": "test",
        },
        Object {
          "baseRef": "W6ycBb05K2cRoMcl2WuUu5B945expanGov3qdbBSQQQ",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -14,8 +14,9 @@
       s a test
      + 
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "251qTDIqE80VXhzQwv6cxKQbdBKLZDF0cT7nb5yU9b4",
          "userId": "test",
        },
        Object {
          "baseRef": "251qTDIqE80VXhzQwv6cxKQbdBKLZDF0cT7nb5yU9b4",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -15,8 +15,9 @@
        a test 
      +o
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "tCj62eJUeEfeJCwMuDHNbvRZb_amTJmaxosczQBtgHo",
          "userId": "test",
        },
        Object {
          "baseRef": "tCj62eJUeEfeJCwMuDHNbvRZb_amTJmaxosczQBtgHo",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -16,8 +16,9 @@
       a test o
      +f
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "hNiND168TnM9INSyK1MnD2jPmzkakcWREm8WkrfD5YY",
          "userId": "test",
        },
        Object {
          "baseRef": "hNiND168TnM9INSyK1MnD2jPmzkakcWREm8WkrfD5YY",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -17,8 +17,9 @@
        test of
      + 
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "9Vppb6TkT7qoiVc1IPUJfDwTwVroj0UVZe1j_PcOPpg",
          "userId": "test",
        },
        Object {
          "baseRef": "9Vppb6TkT7qoiVc1IPUJfDwTwVroj0UVZe1j_PcOPpg",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -18,8 +18,9 @@
       test of 
      +c
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "5KyF7pJyI5cnbSBlq4RrawRLvKrdOzS5n0_IIhojznU",
          "userId": "test",
        },
        Object {
          "baseRef": "5KyF7pJyI5cnbSBlq4RrawRLvKrdOzS5n0_IIhojznU",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -19,8 +19,9 @@
       est of c
      +h
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "XiskLWLZJ5tI8g3EEGJLy-n0CgjG9aTjBApKSMI9PqQ",
          "userId": "test",
        },
        Object {
          "baseRef": "XiskLWLZJ5tI8g3EEGJLy-n0CgjG9aTjBApKSMI9PqQ",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -20,8 +20,9 @@
       st of ch
      +a
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "DZzcTpo0iO0aVJ0B_EzrgGEjl6b3s-N3HgVRSwUbMKw",
          "userId": "test",
        },
        Object {
          "baseRef": "DZzcTpo0iO0aVJ0B_EzrgGEjl6b3s-N3HgVRSwUbMKw",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -21,8 +21,9 @@
       t of cha
      +r
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "c2xgeGDkfkHFGOSZAUDPKi3nXESnHR-L_CKkwCN1RIw",
          "userId": "test",
        },
        Object {
          "baseRef": "c2xgeGDkfkHFGOSZAUDPKi3nXESnHR-L_CKkwCN1RIw",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -22,8 +22,9 @@
        of char
      +a
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "oyBJqg9yjBkN12X_8_7858dWbZ7_lRzgREyD42z10Bg",
          "userId": "test",
        },
        Object {
          "baseRef": "oyBJqg9yjBkN12X_8_7858dWbZ7_lRzgREyD42z10Bg",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -23,8 +23,9 @@
       of chara
      +c
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "_aWnR2LdiqUQxGnaTmLQ2kYny5qLIXoB7rAIibfmjf8",
          "userId": "test",
        },
        Object {
          "baseRef": "_aWnR2LdiqUQxGnaTmLQ2kYny5qLIXoB7rAIibfmjf8",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -24,8 +24,9 @@
       f charac
      +t
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "D7WOTuBQJ8EUrgF_Yrh7DsPI1Q93Y7jlV3MtNlVABS0",
          "userId": "test",
        },
        Object {
          "baseRef": "D7WOTuBQJ8EUrgF_Yrh7DsPI1Q93Y7jlV3MtNlVABS0",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -25,8 +25,9 @@
        charact
      +e
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "D8YJ292UmmMo8lYtBd_HJJQVDfJzhaVfXjJkVNdatV8",
          "userId": "test",
        },
        Object {
          "baseRef": "D8YJ292UmmMo8lYtBd_HJJQVDfJzhaVfXjJkVNdatV8",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -26,8 +26,9 @@
       characte
      +r
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "SMkmpDPzhBzCB0Mk5y6oYHEDnSr8BKzkYOcmh9pGmAk",
          "userId": "test",
        },
        Object {
          "baseRef": "SMkmpDPzhBzCB0Mk5y6oYHEDnSr8BKzkYOcmh9pGmAk",
          "cursorId": "a",
          "delta": Object {
            "hello": Array [
              "@@ -27,8 +27,9 @@
       haracter
      +.
      ",
              0,
              2,
            ],
          },
          "editMetadata": "typing",
          "mergeRef": undefined,
          "ref": "TPoZ3cydRw5-k1EJQ1p-cIiMSqU4Szb6x7GbJDK0IGo",
          "userId": "test",
        },
      ]
    `);
  });
});
