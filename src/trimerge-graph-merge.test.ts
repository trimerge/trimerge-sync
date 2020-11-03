import { MergeHeadNodesFn, TrimergeGraph } from './trimerge-graph';
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

const mergeHeadsFn: MergeHeadNodesFn<any, string> = (base, left, right) => ({
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
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "2",
          "editMetadata": "change hello",
          "ref": "3",
          "value": Object {
            "hello": "vorld",
          },
        },
      }
    `);
    expect(graph.getNodes()).toMatchInlineSnapshot(`
      Map {
        "1" => Object {
          "editMetadata": "initialize",
          "ref": "1",
          "value": Object {},
        },
        "2" => Object {
          "baseRef": "1",
          "editMetadata": "add hello",
          "ref": "2",
          "value": Object {
            "hello": "world",
          },
        },
        "3" => Object {
          "baseRef": "2",
          "editMetadata": "change hello",
          "ref": "3",
          "value": Object {
            "hello": "vorld",
          },
        },
      }
    `);
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
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "3",
          "baseRef2": "5",
          "editMetadata": "merge 3 and 5",
          "ref": "6",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      }
    `);
    expect(graph.getNodes()).toMatchInlineSnapshot(`
      Map {
        "1" => Object {
          "editMetadata": "initialize",
          "ref": "1",
          "value": Object {},
        },
        "2" => Object {
          "baseRef": "1",
          "editMetadata": "add hello",
          "ref": "2",
          "value": Object {
            "hello": "world",
          },
        },
        "3" => Object {
          "baseRef": "2",
          "editMetadata": "change hello",
          "ref": "3",
          "value": Object {
            "hello": "vorld",
          },
        },
        "4" => Object {
          "baseRef": "1",
          "editMetadata": "add world",
          "ref": "4",
          "value": Object {
            "world": "world",
          },
        },
        "5" => Object {
          "baseRef": "4",
          "editMetadata": "change world",
          "ref": "5",
          "value": Object {
            "world": "vorld",
          },
        },
        "6" => Object {
          "baseRef": "3",
          "baseRef2": "5",
          "editMetadata": "merge 3 and 5",
          "ref": "6",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      }
    `);
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
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "3",
          "baseRef2": "6",
          "editMetadata": "merge 3 and 6",
          "ref": "7",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      }
    `);
    expect(graph.getNodes()).toMatchInlineSnapshot(`
      Map {
        "1" => Object {
          "editMetadata": "initialize",
          "ref": "1",
          "value": Object {},
        },
        "2" => Object {
          "baseRef": "1",
          "editMetadata": "add hello",
          "ref": "2",
          "value": Object {
            "hello": "world",
          },
        },
        "3" => Object {
          "baseRef": "2",
          "editMetadata": "change hello",
          "ref": "3",
          "value": Object {
            "hello": "vorld",
          },
        },
        "4" => Object {
          "editMetadata": "initialize",
          "ref": "4",
          "value": Object {},
        },
        "5" => Object {
          "baseRef": "4",
          "editMetadata": "add world",
          "ref": "5",
          "value": Object {
            "world": "world",
          },
        },
        "6" => Object {
          "baseRef": "5",
          "editMetadata": "change world",
          "ref": "6",
          "value": Object {
            "world": "vorld",
          },
        },
        "7" => Object {
          "baseRef": "3",
          "baseRef2": "6",
          "editMetadata": "merge 3 and 6",
          "ref": "7",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
      }
    `);
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
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "10",
          "baseRef2": "9",
          "editMetadata": "merge 10 and 9",
          "ref": "11",
          "value": Object {
            "hello": "vorld",
            "sup": "yoyo",
            "world": "vorld",
          },
        },
      }
    `);
    expect(graph.getNodes()).toMatchInlineSnapshot(`
      Map {
        "1" => Object {
          "editMetadata": "initialize",
          "ref": "1",
          "value": Object {},
        },
        "2" => Object {
          "baseRef": "1",
          "editMetadata": "add hello",
          "ref": "2",
          "value": Object {
            "hello": "world",
          },
        },
        "3" => Object {
          "baseRef": "2",
          "editMetadata": "change hello",
          "ref": "3",
          "value": Object {
            "hello": "vorld",
          },
        },
        "4" => Object {
          "editMetadata": "initialize",
          "ref": "4",
          "value": Object {},
        },
        "5" => Object {
          "baseRef": "4",
          "editMetadata": "add world",
          "ref": "5",
          "value": Object {
            "world": "world",
          },
        },
        "6" => Object {
          "baseRef": "5",
          "editMetadata": "change world",
          "ref": "6",
          "value": Object {
            "world": "vorld",
          },
        },
        "7" => Object {
          "editMetadata": "initialize",
          "ref": "7",
          "value": Object {},
        },
        "8" => Object {
          "baseRef": "7",
          "editMetadata": "add sup",
          "ref": "8",
          "value": Object {
            "sup": "yo",
          },
        },
        "9" => Object {
          "baseRef": "8",
          "editMetadata": "change sup",
          "ref": "9",
          "value": Object {
            "sup": "yoyo",
          },
        },
        "10" => Object {
          "baseRef": "3",
          "baseRef2": "6",
          "editMetadata": "merge 3 and 6",
          "ref": "10",
          "value": Object {
            "hello": "vorld",
            "world": "vorld",
          },
        },
        "11" => Object {
          "baseRef": "10",
          "baseRef2": "9",
          "editMetadata": "merge 10 and 9",
          "ref": "11",
          "value": Object {
            "hello": "vorld",
            "sup": "yoyo",
            "world": "vorld",
          },
        },
      }
    `);
  });
});
