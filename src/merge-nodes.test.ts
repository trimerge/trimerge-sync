import { MergableNode, mergeHeadNodes, MergeNodeFn } from './merge-nodes';

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
    const foo3 = { ref: 'foo-3', baseRef: 'foo-2' };
    const bar3 = { ref: 'bar-3', baseRef: 'bar-2' };
    const getNode = makeGetNodeFn([
      { ref: 'foo' },
      { ref: 'foo-1', baseRef: 'foo' },
      { ref: 'foo-2', baseRef: 'foo-1' },
      foo3,
      { ref: 'bar' },
      { ref: 'bar-1', baseRef: 'bar' },
      { ref: 'bar-2', baseRef: 'bar-1' },
      bar3,
    ]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo3, bar3], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([[undefined, bar3, foo3, 4]]);
  });

  it('find no common parent if there is no overlay', () => {
    const foo = { ref: 'foo' };
    const bar = { ref: 'bar' };
    const baz = { ref: 'baz' };
    const getNode = makeGetNodeFn([foo, bar, baz]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([
      [undefined, bar, baz, 1],
      [
        undefined,
        { baseRef: 'bar', baseRef2: 'baz', ref: '(-:bar+baz)' },
        foo,
        1,
      ],
    ]);
  });

  it('find common parent on v split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo-2', baseRef: 'foo-1' };
    const bar = { ref: 'bar-2', baseRef: 'bar-1' };
    const getNode = makeGetNodeFn([
      root,
      { ref: 'foo', baseRef: 'root' },
      { ref: 'foo-1', baseRef: 'foo' },
      foo,
      { ref: 'bar', baseRef: 'root' },
      { ref: 'bar-1', baseRef: 'bar' },
      bar,
    ]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([[root, bar, foo, 3]]);
  });
  it('find common parent on equal three-way split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const baz = { ref: 'baz', baseRef: 'root' };
    const getNode = makeGetNodeFn([root, foo, bar, baz]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([
      [root, bar, baz, 1],
      [
        root,
        { ref: '(root:bar+baz)', baseRef: 'bar', baseRef2: 'baz' },
        foo,
        1,
      ],
    ]);
  });
  it('find common parent on staggered three-way split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const baz = { ref: 'baz', baseRef: 'root' };
    const baz1 = { ref: 'baz-1', baseRef: 'baz' };
    const getNode = makeGetNodeFn([root, foo, bar, baz, baz1]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar, baz1], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([
      [root, bar, foo, 1],
      [
        root,
        { baseRef: 'bar', baseRef2: 'foo', ref: '(root:bar+foo)' },
        baz1,
        2,
      ],
    ]);
  });
  it('find common parent on staggered three-way split 2', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const foo1 = { ref: 'foo-1', baseRef: 'foo' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const bar1 = { ref: 'bar-1', baseRef: 'bar' };
    const baz = { ref: 'baz', baseRef: 'bar' };
    const getNode = makeGetNodeFn([root, foo, foo1, bar, bar1, baz]);
    const mergeFn = jest.fn(basicMerge);
    mergeHeadNodes([foo, bar1, baz], getNode, mergeFn);
    expect(mergeFn.mock.calls).toEqual([
      [bar, bar1, baz, 1],
      [
        root,
        { baseRef: 'bar-1', baseRef2: 'baz', ref: '(bar:bar-1+baz)' },
        foo,
        1,
      ],
    ]);
  });
});
