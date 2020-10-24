import { MergeHeadsFn } from './trimerge-graph';
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { TrimergeDiffGraph } from './trimerge-sync';
import { diff } from 'jsondiffpatch';
import Jssha from 'jssha';

// Basic trimerge function that merges values, strings, and objects
const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);

const mergeHeadsFn: MergeHeadsFn<any, string> = (base, left, right) => ({
  value: trimergeObjects(base?.value, left.value, right.value),
  editMetadata: `merge ${left.ref.slice(0, 8)} and ${right.ref.slice(
    0,
    8,
  )} (using ${base?.ref.slice(0, 8) ?? 'nothing'})`,
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

function newGraph() {
  return new TrimergeDiffGraph<any, string, any>(diff, refHash);
}

describe('graph.mergeHeads()', () => {
  it('"merges" single node', () => {
    const graph = newGraph();
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    graph.mergeHeads(mergeHeadsFn);
    expect(graph.steps).toMatchInlineSnapshot(`
      Array [
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
              "vorld",
            ],
          },
          "editMetadata": "change hello",
          "ref": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
        },
      ]
    `);
  });

  it('merges v split', () => {
    const graph = newGraph();
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    graph.mergeHeads(mergeHeadsFn);
    expect(graph.steps).toMatchInlineSnapshot(`
      Array [
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
              "vorld",
            ],
          },
          "editMetadata": "change hello",
          "ref": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
        },
        Object {
          "baseRef": "0ee41efbe561307a650fe711d40fc7993f21bcd4ba0dcc1c1abde43974746fba",
          "delta": Object {
            "world": Array [
              "world",
            ],
          },
          "editMetadata": "add world",
          "ref": "383ad58a5485b3f18b992496ce2df5b25e6c96ee6628ad96309dd55a2099cb62",
        },
        Object {
          "baseRef": "383ad58a5485b3f18b992496ce2df5b25e6c96ee6628ad96309dd55a2099cb62",
          "delta": Object {
            "world": Array [
              "world",
              "vorld",
            ],
          },
          "editMetadata": "change world",
          "ref": "b4a0c44eb95b017cff5bb0e87afce7f97094c1225a9cab50a94ca18c241d7740",
        },
        Object {
          "baseRef": "b4a0c44eb95b017cff5bb0e87afce7f97094c1225a9cab50a94ca18c241d7740",
          "baseRef2": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
          "delta": Object {
            "hello": Array [
              "vorld",
            ],
          },
          "editMetadata": "merge b4a0c44e and cb170a2a (using 0ee41efb)",
          "ref": "b83b8e4043d19063a70845df922601b1f8fb76ca60feceb041cfb79938b87494",
        },
      ]
    `);
  });

  it('merge with no common parent', () => {
    const graph = newGraph();
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    graph.mergeHeads(mergeHeadsFn);
    expect(graph.steps).toMatchInlineSnapshot(`
      Array [
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
              "vorld",
            ],
          },
          "editMetadata": "change hello",
          "ref": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
        },
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
            "world": Array [
              "world",
            ],
          },
          "editMetadata": "add world",
          "ref": "383ad58a5485b3f18b992496ce2df5b25e6c96ee6628ad96309dd55a2099cb62",
        },
        Object {
          "baseRef": "383ad58a5485b3f18b992496ce2df5b25e6c96ee6628ad96309dd55a2099cb62",
          "delta": Object {
            "world": Array [
              "world",
              "vorld",
            ],
          },
          "editMetadata": "change world",
          "ref": "b4a0c44eb95b017cff5bb0e87afce7f97094c1225a9cab50a94ca18c241d7740",
        },
        Object {
          "baseRef": "b4a0c44eb95b017cff5bb0e87afce7f97094c1225a9cab50a94ca18c241d7740",
          "baseRef2": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
          "delta": Object {
            "hello": Array [
              "vorld",
            ],
          },
          "editMetadata": "merge b4a0c44e and cb170a2a (using 0ee41efb)",
          "ref": "b83b8e4043d19063a70845df922601b1f8fb76ca60feceb041cfb79938b87494",
        },
      ]
    `);
  });

  it('merge reduces graph to single head', () => {
    const graph = newGraph();
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addInit({}, 'initialize');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yoyo' }, 'change sup');
    graph.mergeHeads(mergeHeadsFn);
    expect(graph.steps).toMatchInlineSnapshot(`
      Array [
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
              "vorld",
            ],
          },
          "editMetadata": "change hello",
          "ref": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
        },
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
            "world": Array [
              "world",
            ],
          },
          "editMetadata": "add world",
          "ref": "383ad58a5485b3f18b992496ce2df5b25e6c96ee6628ad96309dd55a2099cb62",
        },
        Object {
          "baseRef": "383ad58a5485b3f18b992496ce2df5b25e6c96ee6628ad96309dd55a2099cb62",
          "delta": Object {
            "world": Array [
              "world",
              "vorld",
            ],
          },
          "editMetadata": "change world",
          "ref": "b4a0c44eb95b017cff5bb0e87afce7f97094c1225a9cab50a94ca18c241d7740",
        },
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
            "sup": Array [
              "yo",
            ],
          },
          "editMetadata": "add sup",
          "ref": "7a5359a47b2697c35d5af6716bad912c33aa8104fa1e368c310b14fea9dac78a",
        },
        Object {
          "baseRef": "7a5359a47b2697c35d5af6716bad912c33aa8104fa1e368c310b14fea9dac78a",
          "delta": Object {
            "sup": Array [
              "yo",
              "yoyo",
            ],
          },
          "editMetadata": "change sup",
          "ref": "dbd63d0a30beb1da1f0ae8a140bf84fc1a375482f1b85dfa34928f2570be0c86",
        },
        Object {
          "baseRef": "b4a0c44eb95b017cff5bb0e87afce7f97094c1225a9cab50a94ca18c241d7740",
          "baseRef2": "cb170a2a6cd9ce6b1b18f557b8ec315f17a2ac53a94f0e4c16542b272fc4f765",
          "delta": Object {
            "hello": Array [
              "vorld",
            ],
          },
          "editMetadata": "merge b4a0c44e and cb170a2a (using 0ee41efb)",
          "ref": "b83b8e4043d19063a70845df922601b1f8fb76ca60feceb041cfb79938b87494",
        },
        Object {
          "baseRef": "b83b8e4043d19063a70845df922601b1f8fb76ca60feceb041cfb79938b87494",
          "baseRef2": "dbd63d0a30beb1da1f0ae8a140bf84fc1a375482f1b85dfa34928f2570be0c86",
          "delta": Object {
            "sup": Array [
              "yoyo",
            ],
          },
          "editMetadata": "merge b83b8e40 and dbd63d0a (using 0ee41efb)",
          "ref": "8fa1f380518c7345f0c376a5f0dc8e1c82b5f9dbf40065d5e0ee761ebbfd26d5",
        },
      ]
    `);
  });
});
