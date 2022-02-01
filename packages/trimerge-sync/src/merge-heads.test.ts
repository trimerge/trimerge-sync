import {
  mergeHeads,
  MergeCommitsFn,
  SortRefsFn,
  GetCommitFn,
} from './merge-heads';
import { CommitInfo } from './types';

const basicSort: SortRefsFn = (a, b) => (a < b ? -1 : 1);
const basicMerge: MergeCommitsFn = (baseRef, leftRef, rightRef) => {
  return `(${baseRef ?? '-'}:${leftRef}+${rightRef})`;
};

function makeGetCommitFn(
  commits: CommitInfo<void>[],
): GetCommitFn<void, CommitInfo<void>> {
  const map = new Map<string, CommitInfo<void>>();
  for (const commit of commits) {
    map.set(commit.ref, commit);
  }
  return (ref: string) => {
    const commit = map.get(ref);
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
    expect(mergeHeads(['foo3', 'bar3'], basicSort, getCommit, mergeFn)).toEqual(
      '(-:bar3+foo3)',
    );
    expect(mergeFn.mock.calls).toEqual([[undefined, 'bar3', 'foo3', 4]]);
  });

  it('find no common parent for three commits', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'foo' },
      { ref: 'bar' },
      { ref: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(
      mergeHeads(['foo', 'bar', 'baz'], basicSort, getCommit, mergeFn),
    ).toEqual('(-:(-:bar+baz)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      [undefined, 'bar', 'baz', 1],
      [undefined, '(-:bar+baz)', 'foo', 1],
    ]);
  });

  it('find no common parent for two trees, requiring a visitor sort', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'foo' },
      { ref: 'fooA', baseRef: 'bar' },
      { ref: 'fooB', baseRef: 'bar' },
      { ref: 'bar' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(
      mergeHeads(['fooA', 'fooB', 'foo'], basicSort, getCommit, mergeFn),
    ).toEqual('(-:(bar:fooA+fooB)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'fooA', 'fooB', 1],
      [undefined, '(bar:fooA+fooB)', 'foo', 2],
    ]);
  });

  it('basic merge', () => {
    const getCommit = makeGetCommitFn([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(mergeHeads(['foo', 'bar'], basicSort, getCommit, mergeFn)).toEqual(
      '(root:bar+foo)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'bar', 'foo', 1]]);
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
    expect(mergeHeads(['foo2', 'bar2'], basicSort, getCommit, mergeFn)).toEqual(
      '(root:bar2+foo2)',
    );
    expect(mergeFn.mock.calls).toEqual([['root', 'bar2', 'foo2', 3]]);
  });
  it('find common parent on equal three-way split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const baz = { ref: 'baz', baseRef: 'root' };
    const getCommit = makeGetCommitFn([root, foo, bar, baz]);
    const mergeFn = jest.fn(basicMerge);
    expect(
      mergeHeads(['foo', 'bar', 'baz'], basicSort, getCommit, mergeFn),
    ).toEqual('(root:(root:bar+baz)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'bar', 'baz', 1],
      ['root', '(root:bar+baz)', 'foo', 1],
    ]);
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
    expect(
      mergeHeads(['foo', 'bar', 'baz1'], basicSort, getCommit, mergeFn),
    ).toEqual('(root:(root:bar+foo)+baz1)');
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'bar', 'foo', 1],
      ['root', '(root:bar+foo)', 'baz1', 2],
    ]);
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
    expect(
      mergeHeads(['foo', 'bar1', 'baz'], basicSort, getCommit, mergeFn),
    ).toEqual('(root:(bar:bar1+baz)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'bar1', 'baz', 1],
      ['root', '(bar:bar1+baz)', 'foo', 1],
    ]);
  });
});
