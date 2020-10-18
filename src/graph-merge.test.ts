import { Graph, Node } from './graph';
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

function mergeGraphHeadNodes(graph: Graph<any, string>): Node<any, string> {
  return graph.mergeHeads((base, left, right) => ({
    value: trimergeObjects(base?.value, left.value, right.value),
    editMetadata: 'merge',
  }));
}
describe('graph.mergeHeads()', () => {
  it('"merges" single node', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    const mergeNode = mergeGraphHeadNodes(graph);
    expect(mergeNode).toBe(foo);
  });
  it('merges v split', () => {
    const graph = new Graph<any, string>(newId);
    const root = graph.addInit({}, 'initialize');
    let foo = graph.addEdit(root, { hello: 'world' }, 'add hello');
    foo = graph.addEdit(foo, { hello: 'vorld' }, 'change hello');
    let bar = graph.addEdit(root, { world: 'world' }, 'add world');
    bar = graph.addEdit(bar, { world: 'vorld' }, 'change world');
    const mergeNode = mergeGraphHeadNodes(graph);
    expect(mergeNode?.value).toEqual({
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
    const mergeNode = mergeGraphHeadNodes(graph);
    expect(mergeNode?.value).toEqual({
      hello: 'vorld',
      world: 'vorld',
    });
  });
});
