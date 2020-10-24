import { TrimergeGraph } from './trimerge-graph';
import { mergeHeadNodes, MergeNodeFn } from './merge-nodes';

let nextId = 1;
function newId(): string {
  return (nextId++).toString();
}
beforeEach(() => {
  nextId = 1;
});

const basicMerge: MergeNodeFn<any, string> = (base, left, right) => {
  return {
    type: 'merge',
    ref: newId(),
    base: left,
    base2: right,
    editMetadata: 'merge',
    value: base,
  };
};

describe('mergeHeadNodes()', () => {
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
    mergeHeadNodes([foo, bar], fn);
    expect(fn.mock.calls).toEqual([[undefined, foo, bar, 4]]);
  });

  it('find no common parent if there is no overlay', () => {
    const graph = new TrimergeGraph<any, string>(newId);
    const foo = graph.addInit({}, 'initialize');
    const bar = graph.addInit({}, 'initialize');
    const baz = graph.addInit({}, 'initialize');
    const fn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [undefined, foo, bar, 1],
      [undefined, baz, expect.anything(), 1],
    ]);
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
    mergeHeadNodes([foo, bar], fn);
    expect(fn.mock.calls).toEqual([[root, foo, bar, 3]]);
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
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [root, foo, bar, 2],
      [root, baz, expect.anything(), 2],
    ]);
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
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [root, foo, bar, 2],
      [root, baz, expect.anything(), 3],
    ]);
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
    mergeHeadNodes([foo, bar, baz], fn);
    expect(fn.mock.calls).toMatchObject([
      [barRoot, bar, baz, 1],
      [root, foo, expect.anything(), 2],
    ]);
  });
});
