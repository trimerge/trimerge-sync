import { MergeHeadsFn, TrimergeGraph } from './trimerge-graph';
import {
  combineMergers,
  trimergeEquality,
  trimergeObject,
  trimergeString,
} from 'trimerge';

let nextId = 1;
function newId(): string {
  return (nextId++).toString();
}
beforeEach(() => {
  nextId = 1;
});

// Basic trimerge function that merges values, strings, and objects
const trimergeObjects = combineMergers(
  trimergeEquality,
  trimergeString,
  trimergeObject,
);

const mergeHeadsFn: MergeHeadsFn<any, string> = (base, left, right) => ({
  value: trimergeObjects(base?.value, left.value, right.value),
  editMetadata: `merge ${left.ref} and ${right.ref}`,
});

describe('graph.mergeHeads()', () => {
  it('"merges" single node', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    const mergeNode = graph.mergeHeads(mergeHeadsFn);
    expect(mergeNode).toBe(foo);
  });

  it('merges v split', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    const mergeNode = graph.mergeHeads(mergeHeadsFn);
    expect(mergeNode?.value).toEqual({
      hello: 'vorld',
      world: 'vorld',
    });
  });

  it('merge with no common parent', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    const mergeNode = graph.mergeHeads(mergeHeadsFn);
    expect(mergeNode?.value).toEqual({
      hello: 'vorld',
      world: 'vorld',
    });
  });

  it('merge reduces graph to single head', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addInit({}, 'initialize');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yoyo' }, 'change sup');
    const mergeNode = graph.mergeHeads(mergeHeadsFn);
    expect(Array.from(graph.getHeads())).toEqual([mergeNode]);
    expect(Array.from(graph.getHeads())).toMatchInlineSnapshot(`
      Array [
        Object {
          "base": Object {
            "base": Object {
              "base": Object {
                "base": Object {
                  "editMetadata": "initialize",
                  "ref": "1",
                  "type": "init",
                  "value": Object {},
                },
                "editMetadata": "add hello",
                "ref": "2",
                "type": "edit",
                "value": Object {
                  "hello": "world",
                },
              },
              "editMetadata": "change hello",
              "ref": "3",
              "type": "edit",
              "value": Object {
                "hello": "vorld",
              },
            },
            "base2": Object {
              "base": Object {
                "base": Object {
                  "editMetadata": "initialize",
                  "ref": "4",
                  "type": "init",
                  "value": Object {},
                },
                "editMetadata": "add world",
                "ref": "5",
                "type": "edit",
                "value": Object {
                  "world": "world",
                },
              },
              "editMetadata": "change world",
              "ref": "6",
              "type": "edit",
              "value": Object {
                "world": "vorld",
              },
            },
            "editMetadata": "merge 3 and 6",
            "ref": "10",
            "type": "merge",
            "value": Object {
              "hello": "vorld",
              "world": "vorld",
            },
          },
          "base2": Object {
            "base": Object {
              "base": Object {
                "editMetadata": "initialize",
                "ref": "7",
                "type": "init",
                "value": Object {},
              },
              "editMetadata": "add sup",
              "ref": "8",
              "type": "edit",
              "value": Object {
                "sup": "yo",
              },
            },
            "editMetadata": "change sup",
            "ref": "9",
            "type": "edit",
            "value": Object {
              "sup": "yoyo",
            },
          },
          "editMetadata": "merge 10 and 9",
          "ref": "11",
          "type": "merge",
          "value": Object {
            "hello": "vorld",
            "sup": "yoyo",
            "world": "vorld",
          },
        },
      ]
    `);
  });
});
