import { BaseCommit, MergeCommit } from './types';
import Branch from './Branch';

describe('Branch', () => {
  let branch = new Branch();
  let remote = 0;
  let local = 0;
  let merge = 0;
  let main: string[] = [];
  let output: string[] = [];

  function produceLocal(isTemp?: boolean): {
    commit: BaseCommit;
    accept: (expectNewHead?: boolean) => boolean;
    result: string[];
  } {
    const commit = {
      ref: `l${local++}`,
      baseRef: branch.head?.ref,
      delta: undefined,
      metadata: undefined,
    };
    const [...commits] = branch.advanceBranch(commit, isTemp);
    const result = commits.map((commit) => commit.ref);
    output.push(...result);
    const accept = (expectNewHead = false): boolean => {
      const newHead = commits.reduce<boolean>(
        (newHead, commit) => newHead || produceRemote(undefined, commit).result,
        false,
      );
      expect(newHead).toBe(expectNewHead);
      return newHead;
    };
    return { commit, accept, result };
  }

  function lastOf<T>(ary: T[]): T | undefined {
    return ary[ary.length - 1];
  }

  function produceRemote(
    expectNewHead: boolean | undefined = false,
    commit?: BaseCommit,
  ): { commit: BaseCommit; result: boolean } {
    commit ??= {
      ref: `r${remote++}`,
      baseRef: lastOf(main),
      delta: undefined,
      metadata: undefined,
    };
    main.push(commit.ref);
    const result = branch.advanceMain(commit);
    if (expectNewHead !== undefined) expect(result).toBe(expectNewHead);
    return { commit, result };
  }

  function mergeBranch(): {
    commit: MergeCommit;
    accept: (expectNewHead?: boolean) => boolean;
  } {
    if (main.length === 0 || branch.mergeHead === undefined) {
      throw new Error('nothing to merge');
    }
    const commit: MergeCommit = {
      ref: `m${merge++}`,
      baseRef: lastOf(main)!,
      mergeRef: branch.mergeHead.ref,
      delta: undefined,
      metadata: undefined,
    };
    branch.attemptMerge(commit);
    const accept = (expectNewHead = false): boolean => {
      const { result } = produceRemote(expectNewHead, commit);
      if (result) output.push(commit.ref);
      return result;
    };
    return { commit, accept };
  }

  function reset(): void {
    branch = new Branch();
    remote = local = merge = 0;
    main = [];
    output = [];
  }

  afterEach(reset);

  function expectCleanHead(): void {
    expect(branch.hasEdits()).toBe(false);
    expect(branch.needsMerge()).toBe(false);
    expect(branch.size).toEqual(0);
    expect(branch.head?.ref).toEqual(lastOf(main));
    expect(branch.mergeRoot?.ref).toEqual(lastOf(main));
  }

  it('only local edits keep branch empty', () => {
    for (let count = 1; count <= 5; count++) {
      const accepts: Array<() => boolean> = [];
      for (let i = 0; i < count; i++) {
        const { accept, result } = produceLocal();
        accepts.push(accept);
        expect(result).toEqual([`l${local - 1}`]);
        expect(branch.hasEdits()).toBe(true);
        expect(branch.needsMerge()).toBe(false);
      }
      expect(branch.size).toEqual(count);
      const result = accepts
        .map<boolean | undefined>((accept) => accept())
        .reduce((total, result) => (total === result ? total : undefined));
      expect(result).toBe(false);
      expectCleanHead();
    }
    expect(output).toEqual(Array.from({ length: 15 }, (_, i) => `l${i}`));
  });

  it('only remote edits keep branch empty', () => {
    for (let count = 0; count < 5; count++) {
      produceRemote(true);
      expectCleanHead();
    }
    expect(output).toEqual([]);
  });

  it('local and remote edits make the branch dirty', () => {
    for (let count = 0; count < 5; count++) {
      produceRemote(count === 0);
      produceLocal();
    }
    expect(branch.needsMerge()).toBe(true);
  });

  it('accepted merges reset the branch', () => {
    const { commit: first } = produceRemote(true);
    produceLocal();
    produceLocal();
    produceRemote();
    produceRemote();
    expect(branch.needsMerge()).toBe(true);
    expect(branch.mergeRoot).toBe(first);
    const { accept, commit: merge } = mergeBranch();
    accept(true);
    expect([merge.baseRef, merge.mergeRef].sort()).toEqual(['l1', 'r2']);
    expectCleanHead();
    expect(branch.mergeRoot).toBe(merge);
    expect(main).toEqual(['r0', 'r1', 'r2', 'm0']);
    expect(output).toEqual(['l0', 'l1', 'm0']);
  });

  it('late merges update root but keep the branch open', () => {
    const { commit: first } = produceRemote(true);
    produceLocal();
    produceLocal();
    produceRemote();
    produceRemote();
    expect(branch.needsMerge()).toBe(true);
    expect(branch.mergeRoot).toBe(first);
    const { accept, commit: merge } = mergeBranch();
    produceLocal();
    accept();
    expect([merge.baseRef, merge.mergeRef].sort()).toEqual(['l1', 'r2']);
    expect(branch.needsMerge()).toBe(true);
    expect(branch.mergeRoot?.ref).toBe('l1');
    expect(main).toEqual(['r0', 'r1', 'r2', 'm0']);
    expect(output).toEqual(['l0', 'l1', 'l2']);
  });

  it('temp edits produce commits only after non-temp edit', () => {
    const count = 5;
    for (let i = 0; i < count; i++) {
      produceLocal(true);
    }
    expect(output).toEqual([]);
    produceLocal(false);
    expect(output).toEqual(
      Array.from({ length: count + 1 }, (_, i) => `l${i}`),
    );
  });

  it('temp edits are discarded for remote updates', () => {
    let { accept } = produceLocal();
    accept();
    ({ accept } = produceLocal(true));
    accept();
    produceRemote(true);
    expect(output).toEqual(['l0']);
    expect(main).toEqual(['l0', 'r0']);
    expectCleanHead();
  });

  it('temp edits are discarded for remote merges', () => {
    produceRemote(true);
    const { commit: edit } = produceLocal();
    const { commit: temp } = produceLocal(true);
    produceRemote();
    const { commit: main } = produceRemote();
    const { accept, commit: merge } = mergeBranch();
    accept(true);
    expectCleanHead();
    expect(branch.head).toBe(merge);
    expect([merge.baseRef, merge.mergeRef].sort()).toEqual(
      [edit.ref, main.ref].sort(),
    );
    expect(branch.contains(temp)).toBe(false);
  });

  it('temp edits are not affected by late merges', () => {
    produceRemote(true);
    const { commit: edit1 } = produceLocal();
    const { commit: temp1 } = produceLocal(true);
    produceRemote();
    expect(branch.needsMerge()).toBe(true);
    const { accept, commit: merge } = mergeBranch();
    const { commit: edit2 } = produceLocal();
    const { commit: temp2 } = produceLocal(true);
    accept();
    expect(branch.needsMerge()).toBe(true);
    expect([merge.baseRef, merge.mergeRef]).toContain(edit1.ref);
    expect(branch.mergeRoot).toBe(edit1);
    expect(branch.contains(temp1)).toBe(true);
    expect(branch.mergeHead).toBe(edit2);
    expect(branch.head).toBe(temp2);
  });
});
