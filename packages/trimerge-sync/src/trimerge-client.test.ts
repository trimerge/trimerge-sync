import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { TrimergeMemoryStore } from './trimerge-memory-store';
import Jssha from 'jssha';
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

function computeRef(
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: any,
  editMetadata: any,
): string {
  const sha = new Jssha('SHA-256', 'TEXT', { encoding: 'UTF8' });
  sha.update(JSON.stringify([baseRef, mergeRef, delta, editMetadata]));
  return sha.getHash('HEX');
}

const jdp = create({ textDiff: { minLength: 20 } });

function patch<T>(base: T, delta: Delta | undefined): T {
  if (delta === undefined) {
    return base;
  }
  return produce(base, (draft) => jdp.patch(draft, delta));
}

const differ: Differ<any, string, any> = {
  normalize: (state) => state,
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
                "ref": "0ee41efbe561307a650fe711d40fc7993f21bcd4ba0dcc1c1abde43974746fba",
              },
              Object {
                "baseRef": "0ee41efbe561307a650fe711d40fc7993f21bcd4ba0dcc1c1abde43974746fba",
                "delta": Object {
                  "hello": Array [
                    "world",
                  ],
                },
                "editMetadata": "add hello",
                "ref": "a8283d4659134ca86b90fe9fa73786c080243081ff1c03df3fbcc9f9c12143a9",
              },
              Object {
                "baseRef": "a8283d4659134ca86b90fe9fa73786c080243081ff1c03df3fbcc9f9c12143a9",
                "delta": Object {
                  "hello": Array [
                    "world",
                    "world. t",
                  ],
                },
                "editMetadata": "typing",
                "ref": "7905b53e5a0ed3d10dfcc2537d500c343d713da4b419ca928a0b33e5e9834c2e",
              },
              Object {
                "baseRef": "7905b53e5a0ed3d10dfcc2537d500c343d713da4b419ca928a0b33e5e9834c2e",
                "delta": Object {
                  "hello": Array [
                    "world. t",
                    "world. th",
                  ],
                },
                "editMetadata": "typing",
                "ref": "a38015b938792838c8fd8f654442ef5f57cddf07fdc55014534cdfe7db06c038",
              },
              Object {
                "baseRef": "a38015b938792838c8fd8f654442ef5f57cddf07fdc55014534cdfe7db06c038",
                "delta": Object {
                  "hello": Array [
                    "world. th",
                    "world. thi",
                  ],
                },
                "editMetadata": "typing",
                "ref": "ee55d5056392b2d44bd7cfcd74f940cbd0f07c23794148d70fcd5bb4c8fc6a57",
              },
              Object {
                "baseRef": "ee55d5056392b2d44bd7cfcd74f940cbd0f07c23794148d70fcd5bb4c8fc6a57",
                "delta": Object {
                  "hello": Array [
                    "world. thi",
                    "world. this",
                  ],
                },
                "editMetadata": "typing",
                "ref": "05df9df3725488b8fb2360fb9cd38cc8b40aef30a81ee63e5e54a53f552ecaa2",
              },
              Object {
                "baseRef": "05df9df3725488b8fb2360fb9cd38cc8b40aef30a81ee63e5e54a53f552ecaa2",
                "delta": Object {
                  "hello": Array [
                    "world. this",
                    "world. this ",
                  ],
                },
                "editMetadata": "typing",
                "ref": "b09e5f059434efb8277ee7afe6b473a4321babc6f3c71165c8ddb0d771fb319e",
              },
              Object {
                "baseRef": "b09e5f059434efb8277ee7afe6b473a4321babc6f3c71165c8ddb0d771fb319e",
                "delta": Object {
                  "hello": Array [
                    "world. this ",
                    "world. this i",
                  ],
                },
                "editMetadata": "typing",
                "ref": "adbcc7dd1a479b828e5b458c1c88f893c65122a03267ed15bee47bbe1e94aac1",
              },
              Object {
                "baseRef": "adbcc7dd1a479b828e5b458c1c88f893c65122a03267ed15bee47bbe1e94aac1",
                "delta": Object {
                  "hello": Array [
                    "world. this i",
                    "world. this is",
                  ],
                },
                "editMetadata": "typing",
                "ref": "3d33771a1d7581681156ef965650789d1b4e8c13a097d7f5537364e9639b05ea",
              },
              Object {
                "baseRef": "3d33771a1d7581681156ef965650789d1b4e8c13a097d7f5537364e9639b05ea",
                "delta": Object {
                  "hello": Array [
                    "world. this is",
                    "world. this is ",
                  ],
                },
                "editMetadata": "typing",
                "ref": "1ea4161eb3bf07817b7f1ce1781c9c10358c95c3207ca435c4da253ac987dcf9",
              },
              Object {
                "baseRef": "1ea4161eb3bf07817b7f1ce1781c9c10358c95c3207ca435c4da253ac987dcf9",
                "delta": Object {
                  "hello": Array [
                    "world. this is ",
                    "world. this is a",
                  ],
                },
                "editMetadata": "typing",
                "ref": "8205248c6d72d78459a58f5eb876ba1e18dc6a414dec677e9397a22c6a4d2705",
              },
              Object {
                "baseRef": "8205248c6d72d78459a58f5eb876ba1e18dc6a414dec677e9397a22c6a4d2705",
                "delta": Object {
                  "hello": Array [
                    "world. this is a",
                    "world. this is a t",
                  ],
                },
                "editMetadata": "typing",
                "ref": "1dbe67875bdddeef54dd7f7429770e8d3aaee4adf339a5e6d34960add7c2edff",
              },
              Object {
                "baseRef": "1dbe67875bdddeef54dd7f7429770e8d3aaee4adf339a5e6d34960add7c2edff",
                "delta": Object {
                  "hello": Array [
                    "world. this is a t",
                    "world. this is a te",
                  ],
                },
                "editMetadata": "typing",
                "ref": "b80063db3dd368ebc28f38fe7fe4aa752245d60533c10f4a2c6cd925a725bbf7",
              },
              Object {
                "baseRef": "b80063db3dd368ebc28f38fe7fe4aa752245d60533c10f4a2c6cd925a725bbf7",
                "delta": Object {
                  "hello": Array [
                    "world. this is a te",
                    "world. this is a tes",
                  ],
                },
                "editMetadata": "typing",
                "ref": "bf6c1b3116b32b294888c69a907739d94743199d070074005da09643fdbf0c0c",
              },
              Object {
                "baseRef": "bf6c1b3116b32b294888c69a907739d94743199d070074005da09643fdbf0c0c",
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
                "ref": "54b96d1a4ed4afb011d8e5bea7418e7dfc08848a10563e2b685e92cdb3ed5168",
              },
              Object {
                "baseRef": "54b96d1a4ed4afb011d8e5bea7418e7dfc08848a10563e2b685e92cdb3ed5168",
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
                "ref": "735db63f87967f72d18fb99561e0f2fa05eefc6bf5ad41fb388539e6e34fd915",
              },
              Object {
                "baseRef": "735db63f87967f72d18fb99561e0f2fa05eefc6bf5ad41fb388539e6e34fd915",
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
                "ref": "04e211d4ea3a2cdbea30e1a5c26b92661da16ac970cb9d8acc08b431f066d156",
              },
              Object {
                "baseRef": "04e211d4ea3a2cdbea30e1a5c26b92661da16ac970cb9d8acc08b431f066d156",
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
                "ref": "1d421b9df0a1aa23e183a05cb452265c34721cb3a1deba5294a1112b8fe7c4bc",
              },
              Object {
                "baseRef": "1d421b9df0a1aa23e183a05cb452265c34721cb3a1deba5294a1112b8fe7c4bc",
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
                "ref": "5435e17d462b5c677d117d680a65d2ec6c5cb9852cc879f334928409bbb9dac0",
              },
              Object {
                "baseRef": "5435e17d462b5c677d117d680a65d2ec6c5cb9852cc879f334928409bbb9dac0",
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
                "ref": "62cba0e6a4547e5237c1255ea7642c5a2d765ff8a3f5b06ba8ba95987872a422",
              },
              Object {
                "baseRef": "62cba0e6a4547e5237c1255ea7642c5a2d765ff8a3f5b06ba8ba95987872a422",
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
                "ref": "24998189be416fda56a59288c09854e562133c0647d511540488371add5bfb42",
              },
              Object {
                "baseRef": "24998189be416fda56a59288c09854e562133c0647d511540488371add5bfb42",
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
                "ref": "5c149f58a1d86a675c28c3ad09ca693ec9dda8c80a9ce2d464ab18ad880565e2",
              },
              Object {
                "baseRef": "5c149f58a1d86a675c28c3ad09ca693ec9dda8c80a9ce2d464ab18ad880565e2",
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
                "ref": "f8e18cdb72cbcf13a04babb3ec22ae1fde09430e6cc80fc96e9973605da19051",
              },
              Object {
                "baseRef": "f8e18cdb72cbcf13a04babb3ec22ae1fde09430e6cc80fc96e9973605da19051",
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
                "ref": "d8d4222e2032c3e1724b3ffdf0194c070fb197c70c207c38dc6d391fa8058688",
              },
              Object {
                "baseRef": "d8d4222e2032c3e1724b3ffdf0194c070fb197c70c207c38dc6d391fa8058688",
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
                "ref": "1370d281fc1aa6d8545a6373ced098ded3e584b3277ec2d2248ec592b5073c60",
              },
              Object {
                "baseRef": "1370d281fc1aa6d8545a6373ced098ded3e584b3277ec2d2248ec592b5073c60",
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
                "ref": "588a2b5215dc84609ca477043f6f783aa2a29d37bead81ab411ecc82e3974e37",
              },
              Object {
                "baseRef": "588a2b5215dc84609ca477043f6f783aa2a29d37bead81ab411ecc82e3974e37",
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
                "ref": "7c8a1cb9c2c4dd0f00ca59530509629a3b3c8fca5eb0b8584cf751ada3886052",
              },
              Object {
                "baseRef": "7c8a1cb9c2c4dd0f00ca59530509629a3b3c8fca5eb0b8584cf751ada3886052",
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
                "ref": "46598f6ca6aaf5e373fd7cdec879ece6e58c6727853db0c5c1df121bca33c717",
              },
              Object {
                "baseRef": "46598f6ca6aaf5e373fd7cdec879ece6e58c6727853db0c5c1df121bca33c717",
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
                "ref": "be692f4e02111722e67e8c82bc1dd0602627537d8412559970312a9adbe7f1f9",
              },
            ],
            "syncCounter": 1,
          },
        ],
      ]
    `);
  });
});
