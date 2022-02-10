import { mergeHeads, MergeCommitsFn, SortRefsFn } from './merge-heads';
import { CommitInfo } from './types';


const commitMap: Map<string, CommitInfo> = new Map();
const sortMap: Map<string, number> = new Map();
const basicSort: SortRefsFn = (a, b) => {
  const aIdx = sortMap.get(a);
  if (aIdx === undefined) {
    throw new Error('unknown ref ' + a);
  }
  const bIdx = sortMap.get(b);
  if (bIdx === undefined) {
    throw new Error('unknown ref ' + b);
  }
  return aIdx - bIdx;
};
const reverseSort: SortRefsFn = (a, b) => (-1 * basicSort(a, b));
const basicMerge: MergeCommitsFn = (baseRef, leftRef, rightRef) => {
  const ref = `(${baseRef ?? '-'}:${leftRef}+${rightRef})`
  sortMap.set(ref, sortMap.size);
  return ref;
};

function makeGetCommitFn(commits: CommitInfo[]) {
  commitMap.clear();
  sortMap.clear();
  for (const commit of commits) {
    commitMap.set(commit.ref, commit);
    sortMap.set(commit.ref, sortMap.size);
  }
  return (ref: string) => {
    const commit = commitMap.get(ref);
    if (!commit) {
      throw new Error('unknown ref ' + ref);
    }
    return commit;
  };
}

describe('mergeHeads()', () => {
  it('find no common parent for two commits', () => {
    const getCommit = makeGetCommitFn([
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
    const heads = ['foo3', 'bar3'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(-:foo3+bar3)',
    );
    expect(mergeFn.mock.calls).toEqual([[undefined, 'foo3', 'bar3', 4]]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(-:bar3+foo3)',
    );
  });

  it('find no common parent for three commits', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'foo' },
      { ref: 'bar' },
      { ref: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar', 'baz'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn),).toEqual(
      '(-:baz+(-:foo+bar))',
    );
    expect(mergeFn.mock.calls).toEqual([
      [undefined, 'foo', 'bar', 1],
      [undefined, 'baz', '(-:foo+bar)', 1],
    ]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(-:(-:baz+bar)+foo)',
    );
  });

  it('find no common parent for two trees, requiring a visitor sort', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'foo' },
      { ref: 'fooA', baseRef: 'bar' },
      { ref: 'fooB', baseRef: 'bar' },
      { ref: 'bar' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['fooA', 'fooB', 'foo'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(-:foo+(bar:fooA+fooB))',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'fooA', 'fooB', 1],
      [undefined, 'foo', '(bar:fooA+fooB)', 2],
    ]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(-:(bar:fooB+fooA)+foo)',
    );
  });

  it('basic merge', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(root:foo+bar)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'foo', 'bar', 1]]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(root:bar+foo)',
    );
  });

  it('invalid merge with base as merge', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(() =>
      mergeHeads(['root', 'foo'], basicSort, getCommit, mergeFn),
    ).toThrowErrorMatchingInlineSnapshot(
      `"unexpected merge with base === left/right"`,
    );
  });

  it('handles no head commits', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeads([], basicSort, getCommit, mergeFn)).toBeUndefined();
  });

  it('find common parent on v split', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'foo1', baseRef: 'foo' },
      { ref: 'foo2', baseRef: 'foo1' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'bar1', baseRef: 'bar' },
      { ref: 'bar2', baseRef: 'bar1' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo2', 'bar2'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(root:foo2+bar2)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'foo2', 'bar2', 3]]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(root:bar2+foo2)',
    );
  });
  it('find common parent on equal three-way split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const baz = { ref: 'baz', baseRef: 'root' };
    const getCommit = makeGetCommitFn([root, foo, bar, baz]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar', 'baz'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(root:baz+(root:foo+bar))',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'foo', 'bar', 1],
      ['root', 'baz', '(root:foo+bar)', 1],
    ]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(root:(root:baz+bar)+foo)',
    );
  });
  it('find common parent on staggered three-way split', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'baz', baseRef: 'root' },
      { ref: 'baz1', baseRef: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar', 'baz1'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(root:baz1+(root:foo+bar))',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'foo', 'bar', 1],
      ['root', 'baz1', '(root:foo+bar)', 2],
    ]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(root:(root:baz1+bar)+foo)',
    );
  });
  it('find common parent on staggered threeway split 2', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'foo1', baseRef: 'foo' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'bar1', baseRef: 'bar' },
      { ref: 'baz', baseRef: 'bar' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar1', 'baz'];
    expect(mergeHeads(heads, basicSort, getCommit, mergeFn)).toEqual(
      '(root:foo+(bar:bar1+baz))',
    );
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'bar1', 'baz', 1],
      ['root', 'foo', '(bar:bar1+baz)', 2],
    ]);
    expect(mergeHeads(heads, reverseSort, getCommit, mergeFn)).toEqual(
      '(root:(bar:baz+bar1)+foo)',
    );
  });

  it('bad sort is still deterministic', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar'];
    expect(mergeHeads(heads, () => 0, getCommit, mergeFn)).toEqual(
      '(root:bar+foo)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'bar', 'foo', 1]]);
  });
});
