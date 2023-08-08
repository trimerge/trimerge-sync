import { mergeHeads, MergeCommitsFn, SortRefsFn } from './merge-heads';
import { CommitInfo } from './types';

const commitMap: Map<string, CommitInfo> = new Map();
const mergeMap: Map<string, string> = new Map();
const sortMap: Map<string, number> = new Map();
const alphaSort: SortRefsFn = (a, b) => a.localeCompare(b);
const insertSequenceSort: SortRefsFn = (a, b) => {
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
const basicMerge: MergeCommitsFn = (baseRef, leftRef, rightRef) => {
  const ref = `(${baseRef ?? '-'}:${leftRef}+${rightRef})`;
  sortMap.set(ref, sortMap.size);
  return ref;
};

function makeGetCommitAndGetMergeRefFns(commits: CommitInfo[]) {
  commitMap.clear();
  sortMap.clear();
  mergeMap.clear();
  for (const commit of commits) {
    commitMap.set(commit.ref, commit);
    sortMap.set(commit.ref, sortMap.size);
    if (commit.baseRef && commit.mergeRef) {
      mergeMap.set(`${commit.baseRef}+${commit.mergeRef}`, commit.ref);
    }
  }
  return {
    getCommit: (ref: string) => {
      const commit = commitMap.get(ref);
      if (!commit) {
        throw new Error('unknown ref ' + ref);
      }
      return commit;
    },
    getMergeRef: (leftRef: string, rightRef: string) => {
      return mergeMap.get(`${leftRef}+${rightRef}`);
    },
  };
}

describe('mergeHeads()', () => {
  it('find no common parent for two commits', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
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
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(-:bar3+foo3)');
    expect(mergeFn.mock.calls).toEqual([[undefined, 'bar3', 'foo3', 4, false]]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(-:foo3+bar3)');
  });

  it('find no common parent for three commits', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'foo' },
      { ref: 'bar' },
      { ref: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar', 'baz'];
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(-:(-:bar+baz)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      [undefined, 'bar', 'baz', 1, false],
      [undefined, '(-:bar+baz)', 'foo', 1, false],
    ]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(-:baz+(-:foo+bar))');
  });

  it('find no common parent for two trees, requiring a visitor sort', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'foo' },
      { ref: 'bar' },
      { ref: 'fooA', baseRef: 'bar' },
      { ref: 'fooB', baseRef: 'bar' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['fooA', 'fooB', 'foo'];
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(-:(bar:fooA+fooB)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'fooA', 'fooB', 1, false],
      [undefined, '(bar:fooA+fooB)', 'foo', 2, false],
    ]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(-:foo+(bar:fooA+fooB))');
  });

  it('basic merge', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar'];
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:bar+foo)');
    expect(mergeFn.mock.calls).toEqual([['root', 'bar', 'foo', 1, false]]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:foo+bar)');
  });

  it('handles no head commits', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(
      mergeHeads([], alphaSort, getCommit, getMergeRef, (ref) => ref, mergeFn),
    ).toBeUndefined();
  });

  it('find common parent on v split', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
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
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:bar2+foo2)');
    expect(mergeFn.mock.calls).toEqual([['root', 'bar2', 'foo2', 3, false]]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:foo2+bar2)');
  });
  it('find common parent on equal three-way split', () => {
    const root = { ref: 'root' };
    const foo = { ref: 'foo', baseRef: 'root' };
    const bar = { ref: 'bar', baseRef: 'root' };
    const baz = { ref: 'baz', baseRef: 'root' };
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      root,
      foo,
      bar,
      baz,
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar', 'baz'];
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:(root:bar+baz)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'bar', 'baz', 1, false],
      ['root', '(root:bar+baz)', 'foo', 1, false],
    ]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:baz+(root:foo+bar))');
  });
  it('find common parent on staggered three-way split', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'baz', baseRef: 'root' },
      { ref: 'baz1', baseRef: 'baz' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar', 'baz1'];
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:(root:bar+foo)+baz1)');
    expect(mergeFn.mock.calls).toEqual([
      ['root', 'bar', 'foo', 1, false],
      ['root', '(root:bar+foo)', 'baz1', 2, false],
    ]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:baz1+(root:foo+bar))');
  });
  it('find common parent on staggered three-way split 2', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'foo1', baseRef: 'foo' },
      { ref: 'bar', baseRef: 'root' },
      { ref: 'bar1', baseRef: 'bar' },
      { ref: 'baz', baseRef: 'bar' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar1', 'baz'];
    expect(
      mergeHeads(
        heads,
        alphaSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:(bar:bar1+baz)+foo)');
    expect(mergeFn.mock.calls).toEqual([
      ['bar', 'bar1', 'baz', 1, false],
      ['root', '(bar:bar1+baz)', 'foo', 1, false],
    ]);
    expect(
      mergeHeads(
        heads,
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:foo+(bar:bar1+baz))');
  });

  it('bad sort is still deterministic', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'foo', baseRef: 'root' },
      { ref: 'bar', baseRef: 'root' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['foo', 'bar'];
    expect(
      mergeHeads(
        heads,
        () => 0,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toEqual('(root:bar+foo)');
    expect(mergeFn.mock.calls).toEqual([['root', 'bar', 'foo', 1, false]]);
  });

  it('merges ambiguous roots', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'c1-e1', baseRef: 'root' },
      { ref: 'c2-e1', baseRef: 'root' },
      { ref: 'c1-e2', baseRef: 'c1-e1' },
      { ref: 'c2-e2', baseRef: 'c2-e1' },
      { ref: 'c1-m1', baseRef: 'c2-e1', mergeRef: 'c1-e2' },
      { ref: 'c2-m1', baseRef: 'c1-e1', mergeRef: 'c2-e2' },
      { ref: 'c1-e3', baseRef: 'c1-m1' },
      { ref: 'c2-e3', baseRef: 'c2-m1' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    const heads = ['c2-e3', 'c1-e3'];
    expect(
      mergeHeads(
        heads,
        () => 0,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toMatchInlineSnapshot(`"((root:c1-e1+c2-e1):c1-e3+c2-e3)"`);
  });

  it('doesnt recompute unnecessary merges', () => {
    const { getCommit, getMergeRef } = makeGetCommitAndGetMergeRefFns([
      { ref: 'root' },
      { ref: 'c1-e1', baseRef: 'root' },
      { ref: 'c2-e1', baseRef: 'root' },
      { ref: 'c1-e2', baseRef: 'c1-e1' },
      { ref: 'c2-e2', baseRef: 'c2-e1' },
      { ref: 'c1-m1', baseRef: 'c2-e1', mergeRef: 'c1-e2' },
      { ref: 'c2-m1', baseRef: 'c1-e1', mergeRef: 'c2-e2' },
      { ref: 'c1-e3', baseRef: 'c1-m1' },
      { ref: 'c2-e3', baseRef: 'c2-m1' },
      { ref: 'c1-e4', baseRef: 'c1-e3' },
      { ref: 'c2-e4', baseRef: 'c2-e3' },
      { ref: 'c1-m2', baseRef: 'c2-e3', mergeRef: 'c1-e4' },
      { ref: 'c2-m2', baseRef: 'c1-e3', mergeRef: 'c2-e4' },
      { ref: 'c1-e5', baseRef: 'c1-m2' },
      { ref: 'c2-e5', baseRef: 'c2-m2' },
      { ref: 'c1-e6', baseRef: 'c1-e5' },
      { ref: 'c2-e6', baseRef: 'c2-e5' },
      { ref: 'c1-m3', baseRef: 'c2-e5', mergeRef: 'c1-e6' },
      { ref: 'c2-m3', baseRef: 'c1-e5', mergeRef: 'c2-e6' },
      { ref: 'c1-e7', baseRef: 'c1-m3' },
      { ref: 'c2-e7', baseRef: 'c2-m3' },
      { ref: 'c1-e8', baseRef: 'c1-e7' },
      { ref: 'c2-e8', baseRef: 'c2-e7' },
    ]);
    const mergeFn = jest.fn(basicMerge);
    expect(
      mergeHeads(
        ['c2-e6', 'c1-e6'],
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toMatchInlineSnapshot(`"(((root:c1-e1+c2-e1):c1-e3+c2-e3):c1-e6+c2-e6)"`);
    expect(
      mergeHeads(
        ['c2-e8', 'c1-e8'],
        insertSequenceSort,
        getCommit,
        getMergeRef,
        (ref) => ref,
        mergeFn,
      ),
    ).toMatchInlineSnapshot(
      `"((((root:c1-e1+c2-e1):c1-e3+c2-e3):c1-e5+c2-e5):c1-e8+c2-e8)"`,
    );
    expect(mergeFn.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "root",
          "c1-e1",
          "c2-e1",
          1,
          true,
        ],
        [
          "(root:c1-e1+c2-e1)",
          "c1-e3",
          "c2-e3",
          4,
          true,
        ],
        [
          "((root:c1-e1+c2-e1):c1-e3+c2-e3)",
          "c1-e6",
          "c2-e6",
          8,
          false,
        ],
        [
          "((root:c1-e1+c2-e1):c1-e3+c2-e3)",
          "c1-e5",
          "c2-e5",
          7,
          true,
        ],
        [
          "(((root:c1-e1+c2-e1):c1-e3+c2-e3):c1-e5+c2-e5)",
          "c1-e8",
          "c2-e8",
          11,
          false,
        ],
      ]
    `);
  });

  //   it('handles real case: 1', () => {
  //     const {getCommit, getMergeRef} = makeGetCommitFn(
  //       commits_1.sort((a, b) => a.serverIndex - b.serverIndex),
  //     );
  //     const mergeFn = jest.fn(basicMerge);
  //     const heads = ['Ug7i', 'Xvk4'];
  //     expect(
  //       mergeHeads(heads, insertSequenceSort, getCommit, mergeFn),
  //     ).toMatchInlineSnapshot(`"((tI6Z:9r3V+(tI6Z:HvWb+xBhx)):Ug7i+Xvk4)"`);
  //   });
});
