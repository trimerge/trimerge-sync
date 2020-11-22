import { MergeHeadNodesFn, TrimergeGraph } from './trimerge-graph';

let nextId = 1;
function newId(): string {
  return (nextId++).toString();
}
beforeEach(() => {
  nextId = 1;
});

describe('Graph', () => {
  it('add linear edits', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let node = graph.addInit({}, 'initialize');
    node = graph.addEdit(node, { hello: 'world' }, 'add hello');
    node = graph.addEdit(node, { hello: 'vorld' }, 'change hello');
    node = graph.addEdit(node, {}, 'delete hello');
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "3",
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
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
          "baseRef": "3",
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
      }
    `);
  });

  it('add diverging edits', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "3",
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
        Object {
          "baseRef": "7",
          "editMetadata": "delete world",
          "ref": "8",
          "value": Object {},
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
          "baseRef": "3",
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
        "5" => Object {
          "editMetadata": "initialize",
          "ref": "5",
          "value": Object {},
        },
        "6" => Object {
          "baseRef": "5",
          "editMetadata": "add world",
          "ref": "6",
          "value": Object {
            "world": "world",
          },
        },
        "7" => Object {
          "baseRef": "6",
          "editMetadata": "change world",
          "ref": "7",
          "value": Object {
            "world": "vorld",
          },
        },
        "8" => Object {
          "baseRef": "7",
          "editMetadata": "delete world",
          "ref": "8",
          "value": Object {},
        },
      }
    `);
  });
});

describe('mergeHeadNodes()', () => {
  const basicMerge: MergeHeadNodesFn<any, string> = (base, left, right) => {
    return {
      value: base,
      editMetadata: `merge ${left.ref} and ${right.ref}`,
    };
  };
  it('find no common parent if there is none', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    const fn = jest.fn(basicMerge);
    graph.mergeHeads(fn);
    expect(fn.mock.calls).toEqual([[undefined, foo, bar]]);
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "4",
          "editMetadata": "merge 4 and 8",
          "mergeRef": "8",
          "ref": "9",
          "value": undefined,
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
          "baseRef": "3",
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
        "5" => Object {
          "editMetadata": "initialize",
          "ref": "5",
          "value": Object {},
        },
        "6" => Object {
          "baseRef": "5",
          "editMetadata": "add world",
          "ref": "6",
          "value": Object {
            "world": "world",
          },
        },
        "7" => Object {
          "baseRef": "6",
          "editMetadata": "change world",
          "ref": "7",
          "value": Object {
            "world": "vorld",
          },
        },
        "8" => Object {
          "baseRef": "7",
          "editMetadata": "delete world",
          "ref": "8",
          "value": Object {},
        },
        "9" => Object {
          "baseRef": "4",
          "editMetadata": "merge 4 and 8",
          "mergeRef": "8",
          "ref": "9",
          "value": undefined,
        },
      }
    `);
  });

  it('find no common parent if there is no overlay', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const foo = graph.addInit({}, 'initialize');
    const bar = graph.addInit({}, 'initialize');
    const baz = graph.addInit({}, 'initialize');
    const fn = jest.fn(basicMerge);
    graph.mergeHeads(fn);
    expect(fn.mock.calls).toMatchObject([
      [undefined, foo, bar],
      [undefined, baz, expect.anything()],
    ]);
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "3",
          "editMetadata": "merge 3 and 4",
          "mergeRef": "4",
          "ref": "5",
          "value": undefined,
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
          "editMetadata": "initialize",
          "ref": "2",
          "value": Object {},
        },
        "3" => Object {
          "editMetadata": "initialize",
          "ref": "3",
          "value": Object {},
        },
        "4" => Object {
          "baseRef": "1",
          "editMetadata": "merge 1 and 2",
          "mergeRef": "2",
          "ref": "4",
          "value": undefined,
        },
        "5" => Object {
          "baseRef": "3",
          "editMetadata": "merge 3 and 4",
          "mergeRef": "4",
          "ref": "5",
          "value": undefined,
        },
      }
    `);
  });

  it('find common parent on v split', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    const fn = jest.fn(basicMerge);
    graph.mergeHeads(fn);
    expect(fn.mock.calls).toEqual([[root, foo, bar]]);
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "4",
          "editMetadata": "merge 4 and 7",
          "mergeRef": "7",
          "ref": "8",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
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
          "baseRef": "3",
          "editMetadata": "delete hello",
          "ref": "4",
          "value": Object {},
        },
        "5" => Object {
          "baseRef": "1",
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
          "baseRef": "6",
          "editMetadata": "delete world",
          "ref": "7",
          "value": Object {},
        },
        "8" => Object {
          "baseRef": "4",
          "editMetadata": "merge 4 and 7",
          "mergeRef": "7",
          "ref": "8",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
          },
        },
      }
    `);
  });
  it('find common parent on equal three-way split', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addEdit(root, { sup: '' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'change sup');
    const fn = jest.fn(basicMerge);
    graph.mergeHeads(fn);
    expect(fn.mock.calls).toMatchObject([
      [root, foo, bar],
      [root, baz, expect.anything()],
    ]);
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "7",
          "editMetadata": "merge 7 and 8",
          "mergeRef": "8",
          "ref": "9",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
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
          "baseRef": "1",
          "editMetadata": "add sup",
          "ref": "6",
          "value": Object {
            "sup": "",
          },
        },
        "7" => Object {
          "baseRef": "6",
          "editMetadata": "change sup",
          "ref": "7",
          "value": Object {
            "sup": "yo",
          },
        },
        "8" => Object {
          "baseRef": "3",
          "editMetadata": "merge 3 and 5",
          "mergeRef": "5",
          "ref": "8",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
          },
        },
        "9" => Object {
          "baseRef": "7",
          "editMetadata": "merge 7 and 8",
          "mergeRef": "8",
          "ref": "9",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
          },
        },
      }
    `);
  });
  it('find common parent on staggered three-way split', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addEdit(root, { sup: '' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'change sup');
    baz = graph.addEdit(baz, { sup: 'yoyo' }, 'change sup');
    const fn = jest.fn(basicMerge);
    graph.mergeHeads(fn);
    expect(fn.mock.calls).toMatchObject([
      [root, foo, bar],
      [root, baz, expect.anything()],
    ]);
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "8",
          "editMetadata": "merge 8 and 9",
          "mergeRef": "9",
          "ref": "10",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
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
          "baseRef": "1",
          "editMetadata": "add sup",
          "ref": "6",
          "value": Object {
            "sup": "",
          },
        },
        "7" => Object {
          "baseRef": "6",
          "editMetadata": "change sup",
          "ref": "7",
          "value": Object {
            "sup": "yo",
          },
        },
        "8" => Object {
          "baseRef": "7",
          "editMetadata": "change sup",
          "ref": "8",
          "value": Object {
            "sup": "yoyo",
          },
        },
        "9" => Object {
          "baseRef": "3",
          "editMetadata": "merge 3 and 5",
          "mergeRef": "5",
          "ref": "9",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
          },
        },
        "10" => Object {
          "baseRef": "8",
          "editMetadata": "merge 8 and 9",
          "mergeRef": "9",
          "ref": "10",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
          },
        },
      }
    `);
  });
  it('find common parent on staggered three-way split 2', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    const barRoot = graph.addEdit(root, { world: 'world' }, 'add world');
    const bar = graph.addEdit(barRoot, { world: 'vorld' }, 'change world');
    const baz = graph.addEdit(
      barRoot,
      { world: 'world', sup: 'yo' },
      'add sup',
    );
    const fn = jest.fn(basicMerge);
    graph.mergeHeads(fn);
    expect(fn.mock.calls).toMatchObject([
      [barRoot, bar, baz],
      [root, foo, expect.anything()],
    ]);
    expect(graph.getHeads()).toMatchInlineSnapshot(`
      Set {
        Object {
          "baseRef": "3",
          "editMetadata": "merge 3 and 7",
          "mergeRef": "7",
          "ref": "8",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
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
          "baseRef": "4",
          "editMetadata": "add sup",
          "ref": "6",
          "value": Object {
            "sup": "yo",
            "world": "world",
          },
        },
        "7" => Object {
          "baseRef": "5",
          "editMetadata": "merge 5 and 6",
          "mergeRef": "6",
          "ref": "7",
          "value": Object {
            "baseRef": "1",
            "editMetadata": "add world",
            "ref": "4",
            "value": Object {
              "world": "world",
            },
          },
        },
        "8" => Object {
          "baseRef": "3",
          "editMetadata": "merge 3 and 7",
          "mergeRef": "7",
          "ref": "8",
          "value": Object {
            "editMetadata": "initialize",
            "ref": "1",
            "value": Object {},
          },
        },
      }
    `);
  });
});
