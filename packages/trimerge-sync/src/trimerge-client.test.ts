import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { TrimergeMemoryStore } from './trimerge-memory-store';
import { computeRef } from 'trimerge-sync-hash';
import { create, Delta } from 'jsondiffpatch';
import { TrimergeClient } from './trimerge-client';
import { produce } from 'immer';
import { Differ, MergeStateFn } from './differ';

// Basic trimerge function that merges values, strings, and objects
const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);

const merge: MergeStateFn<any, string> = (base, left, right) => ({
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

const differ: Differ<any, string, any> = {
  normalize: (state) => [state, 'normalize'],
  diff: (left, right) => jdp.diff(left, right),
  patch,
  computeRef,
  merge,
};

function newStore() {
  return new TrimergeMemoryStore<any, string, any>(differ);
}

function makeClient(
  store: TrimergeMemoryStore<any, string, any>,
): Promise<TrimergeClient<any, string, any>> {
  return TrimergeClient.create(store, differ, 0);
}

function timeout() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
describe('TrimergeClient', () => {
  it('tracks edits', async () => {
    const store = newStore();
    const client = await makeClient(store);

    client.addEdit({}, 'initialize');
    client.addEdit({ hello: 'world' }, 'add hello');
    client.addEdit({ hello: 'vorld' }, 'change hello');

    expect(client.state).toEqual({ hello: 'vorld' });
  });

  it('edit syncs across two clients', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

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
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

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
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

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
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

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

  it('sync up when second client comes in later', async () => {
    const store = newStore();
    const client1 = await makeClient(store);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = await makeClient(store);

    // client 2 starts out synced
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });
  });

  it('subscription works', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const subscribeFn = jest.fn();

    const unsubscribeFn = client1.subscribe(subscribeFn);

    client1.addEdit({}, 'initialize');
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');

    await timeout();

    const client2 = await makeClient(store);

    // client 2 starts out synced
    expect(client1.state).toEqual({ hello: 'vorld' });
    expect(client2.state).toEqual({ hello: 'vorld' });

    unsubscribeFn();

    expect(subscribeFn.mock.calls).toEqual([
      [undefined],
      [{}],
      [{ hello: 'world' }],
      [{ hello: 'vorld' }],
      [{ hello: 'vorld' }],
    ]);
  });

  it('first two clients conflict, then third one joins', async () => {
    const store = newStore();
    const client1 = await makeClient(store);
    const client2 = await makeClient(store);

    client1.addEdit({}, 'initialize');

    await client1.sync();
    client1.addEdit({ hello: 'world' }, 'add hello');
    client1.addEdit({ hello: 'vorld' }, 'change hello');
    client2.addEdit({ world: 'world' }, 'add world');
    client2.addEdit({ world: 'vorld' }, 'change world');

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

  it('works with lots of character typing', async () => {
    const store = newStore();
    const client1 = await makeClient(store);

    const subscribeFn = jest.fn();
    store.subscribe(0, subscribeFn);

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

    expect(subscribeFn.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          Object {
            "newNodes": Array [
              Object {
                "delta": Array [
                  Object {},
                ],
                "editMetadata": "initialize",
                "ref": "DuQe--VhMHplD-cR1A_HmT8hvNS6DcwcGr3kOXR0b7o",
              },
              Object {
                "baseRef": "DuQe--VhMHplD-cR1A_HmT8hvNS6DcwcGr3kOXR0b7o",
                "delta": Object {
                  "hello": Array [
                    "world",
                  ],
                },
                "editMetadata": "add hello",
                "ref": "HEzioYxFkpuDepy8S78JI-4TcDVQv6VVb6O6k7xw5aY",
              },
              Object {
                "baseRef": "HEzioYxFkpuDepy8S78JI-4TcDVQv6VVb6O6k7xw5aY",
                "delta": Object {
                  "hello": Array [
                    "world",
                    "world. t",
                  ],
                },
                "editMetadata": "typing",
                "ref": "cN0gzU5zDnyC3KhRdxDn-TNlOtzkPiQkPdq_3eu6Z0U",
              },
              Object {
                "baseRef": "cN0gzU5zDnyC3KhRdxDn-TNlOtzkPiQkPdq_3eu6Z0U",
                "delta": Object {
                  "hello": Array [
                    "world. t",
                    "world. th",
                  ],
                },
                "editMetadata": "typing",
                "ref": "_GLt24TNA2NVBL68AWX0mznNIfE6GVPOGEwY-PAGGyM",
              },
              Object {
                "baseRef": "_GLt24TNA2NVBL68AWX0mznNIfE6GVPOGEwY-PAGGyM",
                "delta": Object {
                  "hello": Array [
                    "world. th",
                    "world. thi",
                  ],
                },
                "editMetadata": "typing",
                "ref": "hwPBh_C7c8c7BlbSpdnPTt8UJy8TIgigqsoV6DlT3oc",
              },
              Object {
                "baseRef": "hwPBh_C7c8c7BlbSpdnPTt8UJy8TIgigqsoV6DlT3oc",
                "delta": Object {
                  "hello": Array [
                    "world. thi",
                    "world. this",
                  ],
                },
                "editMetadata": "typing",
                "ref": "1wrvJ1pusx4u3p6iwe4CJ4oY61qkyeo27F2tKuyXqXc",
              },
              Object {
                "baseRef": "1wrvJ1pusx4u3p6iwe4CJ4oY61qkyeo27F2tKuyXqXc",
                "delta": Object {
                  "hello": Array [
                    "world. this",
                    "world. this ",
                  ],
                },
                "editMetadata": "typing",
                "ref": "xXPKMsKTy65RhbF811UkUyJyV17bdezJC5NAkzFqRPA",
              },
              Object {
                "baseRef": "xXPKMsKTy65RhbF811UkUyJyV17bdezJC5NAkzFqRPA",
                "delta": Object {
                  "hello": Array [
                    "world. this ",
                    "world. this i",
                  ],
                },
                "editMetadata": "typing",
                "ref": "xj1FJ11hMP95O2YBQlIS3qgmG4X11e2VgI_Z0ItgqLM",
              },
              Object {
                "baseRef": "xj1FJ11hMP95O2YBQlIS3qgmG4X11e2VgI_Z0ItgqLM",
                "delta": Object {
                  "hello": Array [
                    "world. this i",
                    "world. this is",
                  ],
                },
                "editMetadata": "typing",
                "ref": "u6YRpKr_-g110VuTdXrTy1ZQ2XM4h-hurUxBqaULdRQ",
              },
              Object {
                "baseRef": "u6YRpKr_-g110VuTdXrTy1ZQ2XM4h-hurUxBqaULdRQ",
                "delta": Object {
                  "hello": Array [
                    "world. this is",
                    "world. this is ",
                  ],
                },
                "editMetadata": "typing",
                "ref": "Ns8F28YUQUQKHAERVkKGRehPAvvCQnLKMazr3aCoWjI",
              },
              Object {
                "baseRef": "Ns8F28YUQUQKHAERVkKGRehPAvvCQnLKMazr3aCoWjI",
                "delta": Object {
                  "hello": Array [
                    "world. this is ",
                    "world. this is a",
                  ],
                },
                "editMetadata": "typing",
                "ref": "RIAXoS18MnXlsfclBzhjgQpqU7XcFtjOSkUgNAXzsxw",
              },
              Object {
                "baseRef": "RIAXoS18MnXlsfclBzhjgQpqU7XcFtjOSkUgNAXzsxw",
                "delta": Object {
                  "hello": Array [
                    "world. this is a",
                    "world. this is a t",
                  ],
                },
                "editMetadata": "typing",
                "ref": "smibOYzKySZP5IUi0C4ve2QtPo9cNceFrMMkWfShqS8",
              },
              Object {
                "baseRef": "smibOYzKySZP5IUi0C4ve2QtPo9cNceFrMMkWfShqS8",
                "delta": Object {
                  "hello": Array [
                    "world. this is a t",
                    "world. this is a te",
                  ],
                },
                "editMetadata": "typing",
                "ref": "r4Gt8j4s5fKbEwdgb-vjvme3QtL2hAvU9ZzzhCznb60",
              },
              Object {
                "baseRef": "r4Gt8j4s5fKbEwdgb-vjvme3QtL2hAvU9ZzzhCznb60",
                "delta": Object {
                  "hello": Array [
                    "world. this is a te",
                    "world. this is a tes",
                  ],
                },
                "editMetadata": "typing",
                "ref": "3jM0UuucdEXbLT9Nkm0k2_2E9vi11QkaWDWhbcVm_eg",
              },
              Object {
                "baseRef": "3jM0UuucdEXbLT9Nkm0k2_2E9vi11QkaWDWhbcVm_eg",
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
                "ref": "BYv1aNJTeM4KWxLxbUq7K8Ezo8Avl7BIRxdPA3_YMa0",
              },
              Object {
                "baseRef": "BYv1aNJTeM4KWxLxbUq7K8Ezo8Avl7BIRxdPA3_YMa0",
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
                "ref": "mUCEo0ahS-cyutoEMBy6Z1goBB19H9nVhIlcRIR1gXA",
              },
              Object {
                "baseRef": "mUCEo0ahS-cyutoEMBy6Z1goBB19H9nVhIlcRIR1gXA",
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
                "ref": "8xvrbABLv3aQCZ-mXSmz9aw99ycGnWfMDCBwuHe-hDY",
              },
              Object {
                "baseRef": "8xvrbABLv3aQCZ-mXSmz9aw99ycGnWfMDCBwuHe-hDY",
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
                "ref": "04an6zk86mFNbRBpcmzPncHkmhLYa4MElu2W7gpW-ug",
              },
              Object {
                "baseRef": "04an6zk86mFNbRBpcmzPncHkmhLYa4MElu2W7gpW-ug",
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
                "ref": "k3VTrJ_UAM_cDSFTR6BF7CG0L83GT3HnKCr380fo6Ec",
              },
              Object {
                "baseRef": "k3VTrJ_UAM_cDSFTR6BF7CG0L83GT3HnKCr380fo6Ec",
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
                "ref": "MQdenrPuumHKRCEXD6MgrvuOcJ96651XW1QXfIEP7IQ",
              },
              Object {
                "baseRef": "MQdenrPuumHKRCEXD6MgrvuOcJ96651XW1QXfIEP7IQ",
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
                "ref": "fhYumn1_x_DNmK1dw-_CHm4b31EIw8_Q_W_46RmEnLk",
              },
              Object {
                "baseRef": "fhYumn1_x_DNmK1dw-_CHm4b31EIw8_Q_W_46RmEnLk",
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
                "ref": "vFe1kJf4tsYult6AebUBA4_SBwbBZm5EMj2Xa7TWJ7c",
              },
              Object {
                "baseRef": "vFe1kJf4tsYult6AebUBA4_SBwbBZm5EMj2Xa7TWJ7c",
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
                "ref": "IDyckGvnUKARtG6E4AOid7VDdqRh2x1SS_xmVU9UZfM",
              },
              Object {
                "baseRef": "IDyckGvnUKARtG6E4AOid7VDdqRh2x1SS_xmVU9UZfM",
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
                "ref": "7qMRlGA8rvBBFGSU3KKxvtEQ9aJCjYWRCZYfSYOaDuE",
              },
              Object {
                "baseRef": "7qMRlGA8rvBBFGSU3KKxvtEQ9aJCjYWRCZYfSYOaDuE",
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
                "ref": "K2Zi-zy9qB8GXNWlnRzCV1QqcbRIi20OaXA0HmZnU8I",
              },
              Object {
                "baseRef": "K2Zi-zy9qB8GXNWlnRzCV1QqcbRIi20OaXA0HmZnU8I",
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
                "ref": "tdhK9Ud9T4mTIln3X1p1O_y9Cllv_-uqd82aUqMRNT4",
              },
              Object {
                "baseRef": "tdhK9Ud9T4mTIln3X1p1O_y9Cllv_-uqd82aUqMRNT4",
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
                "ref": "uMNXZBwlkRdyx1P9RTaXUsR51lI8BoZaR0xdCwQc_44",
              },
              Object {
                "baseRef": "uMNXZBwlkRdyx1P9RTaXUsR51lI8BoZaR0xdCwQc_44",
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
                "ref": "zXMIEZNPxkjAuwYAb6sFspB2ly4mjCJuKMRRfSSq2kw",
              },
              Object {
                "baseRef": "zXMIEZNPxkjAuwYAb6sFspB2ly4mjCJuKMRRfSSq2kw",
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
                "ref": "fiD1YJW-lrf11sDYv_PLb55X2_B_b_8p29NRVbEziJ4",
              },
            ],
            "syncCounter": 1,
          },
        ],
      ]
    `);
  });
});
