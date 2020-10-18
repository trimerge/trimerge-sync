import { Graph } from './graph';
import { commonAncestor, commonParent, merge } from './trimerge-graph';
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

describe('commonParent()', () => {
  it('find no common parent if there is none', () => {
    const graph = new Graph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    expect(commonParent(foo, bar)).toBeUndefined();
  });

  it('find common parent on v split', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    expect(commonParent(foo, bar)).toEqual({ parent: root, depth: 3 });
  });

  it('merges v split', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    const mergeNode = merge(graph, trimergeObjects, () => 'merge', foo, bar);
    expect(mergeNode.value).toEqual({
      hello: 'vorld',
      world: 'vorld',
    });
  });
  it('merge with no common parent', () => {
    const graph = new Graph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    const mergeNode = merge(graph, trimergeObjects, () => 'merge', foo, bar);
    expect(mergeNode.value).toEqual({
      hello: 'vorld',
      world: 'vorld',
    });
  });
});

describe('commonAncestor()', () => {
  it('find no common parent if there is none', () => {
    const graph = new Graph<any, string>(newId);
    let foo = graph.addInit({}, 'initialize');
    foo = graph.addEdit(foo, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addInit({}, 'initialize');
    bar = graph.addEdit(bar, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    expect(Array.from(commonAncestor([foo, bar]))).toEqual([]);
  });

  it('find common parent on v split', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    foo = graph.addEdit(foo, {}, 'delete hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    bar = graph.addEdit(bar, {}, 'delete world');
    expect(Array.from(commonAncestor([foo, bar]))).toEqual([
      { base: root, left: foo, right: bar, depth: 3 },
    ]);
  });
  it('find common parent on equal three-way split', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addEdit(root, { sup: '' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'change sup');
    expect(Array.from(commonAncestor([foo, bar, baz]))).toEqual([
      { base: root, left: foo, right: bar, depth: 2 },
      { base: root, left: root, right: baz, depth: 2 },
    ]);
  });
  it('find common parent on staggered three-way split', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    let baz = graph.addEdit(root, { sup: '' }, 'add sup');
    baz = graph.addEdit(baz, { sup: 'yo' }, 'change sup');
    baz = graph.addEdit(baz, { sup: 'yoyo' }, 'change sup');
    expect(Array.from(commonAncestor([foo, bar, baz]))).toEqual([
      { base: root, left: foo, right: bar, depth: 2 },
      { base: root, left: root, right: baz, depth: 3 },
    ]);
  });
  it('find common parent on staggered three-way split 2', () => {
    const graph = new Graph<any, string>(newId);
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
    expect(Array.from(commonAncestor([foo, bar, baz]))).toEqual([
      { base: barRoot, left: bar, right: baz, depth: 1 },
      { base: root, left: foo, right: barRoot, depth: 2 },
    ]);
  });
});
