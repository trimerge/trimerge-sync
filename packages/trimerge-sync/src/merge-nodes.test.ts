import { MergableNode, mergeHeadNodes, MergeNodeFn } from './merge-nodes';

const basicMerge: MergeNodeFn = (baseRef, leftRef, rightRef) => {
  return `(${baseRef ?? '-'}:${leftRef}+${rightRef})`;
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
  it('find no common parent for two nodes', () => {
    const getNode = makeGetNodeFn([
      { ref: 'foo' },
      { ref: 'foo1', baseRef: 'foo' },
      { ref: 'foo2', baseRef: 'foo1' },
      { ref: 'foo3', baseRef: 'foo2' },
      { ref: 'bar' },
      { ref: 'bar1', baseRef: 'bar' },
      { ref: 'bar2', baseRef: 'bar1' },
      { ref: 'bar3', baseRef: 'bar2' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo3', 'bar3'], getNode, mergeFn)).toEqual(
      '(-:bar3+foo3)',
    );
    expect(mergeFn.mock.calls).toEqual([[undefined, 'bar3', 'foo3', 4]]);
  });

  it('find no common parent for three nodes', () => {
    const getNode = makeGetNodeFn([
      { ref: 'foo' },
      { ref: 'bar' },
      { ref: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo', 'bar', 'baz'], getNode, mergeFn)).toEqual(
      '(-:(-:bar+baz)+foo)',
    );
    expect(mergeFn.mock.calls).toEqual([
      [undefined, 'bar', 'baz', 1],
      [undefined, '(-:bar+baz)', 'foo', 1],
    ]);
  });

  it('basic merge', () => {
    const getNode = makeGetNodeFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo', 'bar'], getNode, mergeFn)).toEqual(
      '(root:bar+foo)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'bar', 'foo', 1]]);
  });
  it('invalid merge with base as merge', () => {
    const getNode = makeGetNodeFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(() =>
      mergeHeadNodes(['root', 'foo'], getNode, mergeFn),
    ).toThrowErrorMatchingInlineSnapshot(
      `"unexpected merge with base === left/right"`,
    );
  });
  it('find common parent on v split', () => {
    const getNode = makeGetNodeFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'foo1', baseRef: 'foo' },
      { ref: 'foo2', baseRef: 'foo1' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'bar1', baseRef: 'bar' },
      { ref: 'bar2', baseRef: 'bar1' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo2', 'bar2'], getNode, mergeFn)).toEqual(
      '(root:bar2+foo2)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'bar2', 'foo2', 3]]);
  });
  it('find common parent on equal three-way split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const baz = { ref: 'baz', baseRef: 'root' };
    const getNode = makeGetNodeFn([root, foo, bar, baz]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo', 'bar', 'baz'], getNode, mergeFn)).toEqual(
      '(root:(root:bar+baz)+foo)',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'bar', 'baz', 1],
      ['root', '(root:bar+baz)', 'foo', 1],
    ]);
  });
  it('find common parent on staggered three-way split', () => {
    const getNode = makeGetNodeFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'baz', baseRef: 'root' },
      { ref: 'baz1', baseRef: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo', 'bar', 'baz1'], getNode, mergeFn)).toEqual(
      '(root:(root:bar+foo)+baz1)',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'bar', 'foo', 1],
      ['root', '(root:bar+foo)', 'baz1', 2],
    ]);
  });
  it('find common parent on staggered threeway split 2', () => {
    const getNode = makeGetNodeFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'foo1', baseRef: 'foo' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'bar1', baseRef: 'bar' },
      { ref: 'baz', baseRef: 'bar' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeadNodes(['foo', 'bar1', 'baz'], getNode, mergeFn)).toEqual(
      '(root:(bar:bar1+baz)+foo)',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'bar1', 'baz', 1],
      ['root', '(bar:bar1+baz)', 'foo', 1],
    ]);
  });
});
