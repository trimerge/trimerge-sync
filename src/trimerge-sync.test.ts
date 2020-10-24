import { MergeHeadsFn } from './trimerge-graph';
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';
import { TrimergeDiffGraph } from './trimerge-sync';
import { create } from 'jsondiffpatch';
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

const jdp = create({ textDiff: { minLength: 20 } });

function newGraph() {
  return new TrimergeDiffGraph<any, string, any>(jdp.diff.bind(jdp), refHash);
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

  it('linear editing', () => {
    const graph = newGraph();
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'world. t' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. th' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. thi' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this ' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this i' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is ' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a t' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a te' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a tes' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a test' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a test ' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a test o' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a test of' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a test of ' }, 'typing');
    foo = graph.addEdit(foo, { hello: 'world. this is a test of c' }, 'typing');
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of ch' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of cha' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of char' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of chara' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of charac' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of charact' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of characte' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of character' },
      'typing',
    );
    foo = graph.addEdit(
      foo,
      { hello: 'world. this is a test of character.' },
      'typing',
    );
    graph.mergeHeads(mergeHeadsFn);
    expect(graph.steps).toEqual([
      {
        delta: [{}],
        editMetadata: 'initialize',
        ref: '0ee41efbe561307a650fe711d40fc7993f21bcd4ba0dcc1c1abde43974746fba',
      },
      {
        baseRef:
          '0ee41efbe561307a650fe711d40fc7993f21bcd4ba0dcc1c1abde43974746fba',
        delta: {
          hello: ['world'],
        },
        editMetadata: 'add hello',
        ref: 'a8283d4659134ca86b90fe9fa73786c080243081ff1c03df3fbcc9f9c12143a9',
      },
      {
        baseRef:
          'a8283d4659134ca86b90fe9fa73786c080243081ff1c03df3fbcc9f9c12143a9',
        delta: {
          hello: ['world', 'world. t'],
        },
        editMetadata: 'typing',
        ref: '7905b53e5a0ed3d10dfcc2537d500c343d713da4b419ca928a0b33e5e9834c2e',
      },
      {
        baseRef:
          '7905b53e5a0ed3d10dfcc2537d500c343d713da4b419ca928a0b33e5e9834c2e',
        delta: {
          hello: ['world. t', 'world. th'],
        },
        editMetadata: 'typing',
        ref: 'a38015b938792838c8fd8f654442ef5f57cddf07fdc55014534cdfe7db06c038',
      },
      {
        baseRef:
          'a38015b938792838c8fd8f654442ef5f57cddf07fdc55014534cdfe7db06c038',
        delta: {
          hello: ['world. th', 'world. thi'],
        },
        editMetadata: 'typing',
        ref: 'ee55d5056392b2d44bd7cfcd74f940cbd0f07c23794148d70fcd5bb4c8fc6a57',
      },
      {
        baseRef:
          'ee55d5056392b2d44bd7cfcd74f940cbd0f07c23794148d70fcd5bb4c8fc6a57',
        delta: {
          hello: ['world. thi', 'world. this'],
        },
        editMetadata: 'typing',
        ref: '05df9df3725488b8fb2360fb9cd38cc8b40aef30a81ee63e5e54a53f552ecaa2',
      },
      {
        baseRef:
          '05df9df3725488b8fb2360fb9cd38cc8b40aef30a81ee63e5e54a53f552ecaa2',
        delta: {
          hello: ['world. this', 'world. this '],
        },
        editMetadata: 'typing',
        ref: 'b09e5f059434efb8277ee7afe6b473a4321babc6f3c71165c8ddb0d771fb319e',
      },
      {
        baseRef:
          'b09e5f059434efb8277ee7afe6b473a4321babc6f3c71165c8ddb0d771fb319e',
        delta: {
          hello: ['world. this ', 'world. this i'],
        },
        editMetadata: 'typing',
        ref: 'adbcc7dd1a479b828e5b458c1c88f893c65122a03267ed15bee47bbe1e94aac1',
      },
      {
        baseRef:
          'adbcc7dd1a479b828e5b458c1c88f893c65122a03267ed15bee47bbe1e94aac1',
        delta: {
          hello: ['world. this i', 'world. this is'],
        },
        editMetadata: 'typing',
        ref: '3d33771a1d7581681156ef965650789d1b4e8c13a097d7f5537364e9639b05ea',
      },
      {
        baseRef:
          '3d33771a1d7581681156ef965650789d1b4e8c13a097d7f5537364e9639b05ea',
        delta: {
          hello: ['world. this is', 'world. this is '],
        },
        editMetadata: 'typing',
        ref: '1ea4161eb3bf07817b7f1ce1781c9c10358c95c3207ca435c4da253ac987dcf9',
      },
      {
        baseRef:
          '1ea4161eb3bf07817b7f1ce1781c9c10358c95c3207ca435c4da253ac987dcf9',
        delta: {
          hello: ['world. this is ', 'world. this is a'],
        },
        editMetadata: 'typing',
        ref: '8205248c6d72d78459a58f5eb876ba1e18dc6a414dec677e9397a22c6a4d2705',
      },
      {
        baseRef:
          '8205248c6d72d78459a58f5eb876ba1e18dc6a414dec677e9397a22c6a4d2705',
        delta: {
          hello: ['world. this is a', 'world. this is a t'],
        },
        editMetadata: 'typing',
        ref: '1dbe67875bdddeef54dd7f7429770e8d3aaee4adf339a5e6d34960add7c2edff',
      },
      {
        baseRef:
          '1dbe67875bdddeef54dd7f7429770e8d3aaee4adf339a5e6d34960add7c2edff',
        delta: {
          hello: ['world. this is a t', 'world. this is a te'],
        },
        editMetadata: 'typing',
        ref: 'b80063db3dd368ebc28f38fe7fe4aa752245d60533c10f4a2c6cd925a725bbf7',
      },
      {
        baseRef:
          'b80063db3dd368ebc28f38fe7fe4aa752245d60533c10f4a2c6cd925a725bbf7',
        delta: {
          hello: ['world. this is a te', 'world. this is a tes'],
        },
        editMetadata: 'typing',
        ref: 'bf6c1b3116b32b294888c69a907739d94743199d070074005da09643fdbf0c0c',
      },
      {
        baseRef:
          'bf6c1b3116b32b294888c69a907739d94743199d070074005da09643fdbf0c0c',
        delta: {
          hello: ['@@ -13,8 +13,9 @@\n is a tes\n+t\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '54b96d1a4ed4afb011d8e5bea7418e7dfc08848a10563e2b685e92cdb3ed5168',
      },
      {
        baseRef:
          '54b96d1a4ed4afb011d8e5bea7418e7dfc08848a10563e2b685e92cdb3ed5168',
        delta: {
          hello: ['@@ -14,8 +14,9 @@\n s a test\n+ \n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '735db63f87967f72d18fb99561e0f2fa05eefc6bf5ad41fb388539e6e34fd915',
      },
      {
        baseRef:
          '735db63f87967f72d18fb99561e0f2fa05eefc6bf5ad41fb388539e6e34fd915',
        delta: {
          hello: ['@@ -15,8 +15,9 @@\n  a test \n+o\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '04e211d4ea3a2cdbea30e1a5c26b92661da16ac970cb9d8acc08b431f066d156',
      },
      {
        baseRef:
          '04e211d4ea3a2cdbea30e1a5c26b92661da16ac970cb9d8acc08b431f066d156',
        delta: {
          hello: ['@@ -16,8 +16,9 @@\n a test o\n+f\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '1d421b9df0a1aa23e183a05cb452265c34721cb3a1deba5294a1112b8fe7c4bc',
      },
      {
        baseRef:
          '1d421b9df0a1aa23e183a05cb452265c34721cb3a1deba5294a1112b8fe7c4bc',
        delta: {
          hello: ['@@ -17,8 +17,9 @@\n  test of\n+ \n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '5435e17d462b5c677d117d680a65d2ec6c5cb9852cc879f334928409bbb9dac0',
      },
      {
        baseRef:
          '5435e17d462b5c677d117d680a65d2ec6c5cb9852cc879f334928409bbb9dac0',
        delta: {
          hello: ['@@ -18,8 +18,9 @@\n test of \n+c\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '62cba0e6a4547e5237c1255ea7642c5a2d765ff8a3f5b06ba8ba95987872a422',
      },
      {
        baseRef:
          '62cba0e6a4547e5237c1255ea7642c5a2d765ff8a3f5b06ba8ba95987872a422',
        delta: {
          hello: ['@@ -19,8 +19,9 @@\n est of c\n+h\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '24998189be416fda56a59288c09854e562133c0647d511540488371add5bfb42',
      },
      {
        baseRef:
          '24998189be416fda56a59288c09854e562133c0647d511540488371add5bfb42',
        delta: {
          hello: ['@@ -20,8 +20,9 @@\n st of ch\n+a\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '5c149f58a1d86a675c28c3ad09ca693ec9dda8c80a9ce2d464ab18ad880565e2',
      },
      {
        baseRef:
          '5c149f58a1d86a675c28c3ad09ca693ec9dda8c80a9ce2d464ab18ad880565e2',
        delta: {
          hello: ['@@ -21,8 +21,9 @@\n t of cha\n+r\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: 'f8e18cdb72cbcf13a04babb3ec22ae1fde09430e6cc80fc96e9973605da19051',
      },
      {
        baseRef:
          'f8e18cdb72cbcf13a04babb3ec22ae1fde09430e6cc80fc96e9973605da19051',
        delta: {
          hello: ['@@ -22,8 +22,9 @@\n  of char\n+a\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: 'd8d4222e2032c3e1724b3ffdf0194c070fb197c70c207c38dc6d391fa8058688',
      },
      {
        baseRef:
          'd8d4222e2032c3e1724b3ffdf0194c070fb197c70c207c38dc6d391fa8058688',
        delta: {
          hello: ['@@ -23,8 +23,9 @@\n of chara\n+c\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '1370d281fc1aa6d8545a6373ced098ded3e584b3277ec2d2248ec592b5073c60',
      },
      {
        baseRef:
          '1370d281fc1aa6d8545a6373ced098ded3e584b3277ec2d2248ec592b5073c60',
        delta: {
          hello: ['@@ -24,8 +24,9 @@\n f charac\n+t\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '588a2b5215dc84609ca477043f6f783aa2a29d37bead81ab411ecc82e3974e37',
      },
      {
        baseRef:
          '588a2b5215dc84609ca477043f6f783aa2a29d37bead81ab411ecc82e3974e37',
        delta: {
          hello: ['@@ -25,8 +25,9 @@\n  charact\n+e\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '7c8a1cb9c2c4dd0f00ca59530509629a3b3c8fca5eb0b8584cf751ada3886052',
      },
      {
        baseRef:
          '7c8a1cb9c2c4dd0f00ca59530509629a3b3c8fca5eb0b8584cf751ada3886052',
        delta: {
          hello: ['@@ -26,8 +26,9 @@\n characte\n+r\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: '46598f6ca6aaf5e373fd7cdec879ece6e58c6727853db0c5c1df121bca33c717',
      },
      {
        baseRef:
          '46598f6ca6aaf5e373fd7cdec879ece6e58c6727853db0c5c1df121bca33c717',
        delta: {
          hello: ['@@ -27,8 +27,9 @@\n haracter\n+.\n', 0, 2],
        },
        editMetadata: 'typing',
        ref: 'be692f4e02111722e67e8c82bc1dd0602627537d8412559970312a9adbe7f1f9',
      },
    ]);
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
