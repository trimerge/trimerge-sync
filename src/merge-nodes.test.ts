import { MergableNode, mergeHeadNodes, MergeNodeFn } from './merge-nodes';

let nextId = 1;
function newId(): string {
  return (nextId++).toString();
}
beforeEach(() => {
  nextId = 1;
});

const basicMerge: MergeNodeFn<MergableNode> = (base, left, right) => {
  return {
    ref: `(${base?.ref ?? '-'}:${left.ref}+${right.ref})`,
    baseRef: left.ref,
    baseRef2: right.ref,
  };
};

function makeGetNodeFn(nodes: MergableNode[]) {
  const map = new Map<string, MergableNode>();
  for (const node of nodes) {
    map.set(node.ref, node);
  }
  return (ref: string) => {
    const node = map.get(ref);
    if (!node) {
      throw new Error('unknown ref ' + ref);
    }
    return node;
  };
}

describe('mergeHeadNodes()', () => {
  it('find no common parent if there is none', () => {
    const getNode = makeGetNodeFn([
      { ref: 'foo' },
      { ref: 'foo-1', baseRef: 'foo' },
      { ref: 'foo-2', baseRef: 'foo-1' },
      { ref: 'foo-3', baseRef: 'foo-2' },
      { ref: 'bar' },
      { ref: 'bar-1', baseRef: 'bar' },
      { ref: 'bar-2', baseRef: 'bar-1' },
      { ref: 'bar-3', baseRef: 'bar-2' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([getNode('foo-3'), getNode('bar-3')], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([
      [undefined, getNode('foo-3'), getNode('bar-3'), 4],
    ]);
  });

  it('find no common parent if there is no overlay', () => {
    const foo = { ref: 'foo' };
    const bar = { ref: 'bar' };
    const baz = { ref: 'baz' };
    const getNode = makeGetNodeFn([foo, bar, baz]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz], getNode, mergeFn);
    expect(mergeFn.mock.calls).toMatchObject([
      [undefined, bar, baz, 1],
      [undefined, foo, expect.anything(), 1],
    ]);
  });

  it('find common parent on v split', () => {
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    const fn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar], fn);
    expect(fn.mock.calls).toEqual([[root, foo, bar, 3]]);
  });
  it('find common parent on equal three-way split', () => {
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addEdit(root, { sup: '' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'change sup');
    const fn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [root, foo, bar, 2],
      [root, baz, expect.anything(), 2],
    ]);
  });
  it('find common parent on staggered three-way split', () => {
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addEdit(root, { sup: '' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'change sup');
    baz = graph.addEdit(baz, { sup: 'yoyo' }, 'change sup');
    const fn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [root, foo, bar, 2],
      [root, baz, expect.anything(), 3],
    ]);
  });
  it('find common parent on staggered three-way split 2', () => {
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
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [barRoot, bar, baz, 1],
      [root, foo, expect.anything(), 2],
    ]);
  });
});
