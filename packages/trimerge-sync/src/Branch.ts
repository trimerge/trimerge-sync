/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { BaseCommit, MergeCommit, isMergeCommit } from './types';

export default class Branch<C, D> {
  private refs: Map<string, Node<C, D>> = new Map();
  private root: Origin<C, D> | Node<C, D>;
  private edit: Origin<C, D> | Node<C, D>;
  private temp: Origin<C, D> | Node<C, D>;
  private merge:
    | {
        base: string;
        commit: MergeCommit<C, D>;
      }
    | undefined;
  private dirtySince: Date | undefined;

  constructor() {
    // TODO: optionally accept heads (and merger) to resume prior state
    this.root = this.edit = this.temp = new Origin();
  }

  /**
   * Tests if there are pending merges on the edit branch
   */
  public hasEdits(): boolean {
    return this.root !== this.edit;
  }

  /**
   * Tests if a merge is required
   */
  public needsMerge(): boolean {
    return this.dirtySince !== undefined;
  }

  /**
   * Called when there is a divergence between the main and edit branches (both have commits not in the other)
   * @private
   */
  private makeDirty(): void {
    // TODO: trigger a new attempted merge to main if possible (only one in-flight attempt allowed)
    this.dirtySince ??= new Date(Date.now());
  }

  /**
   * Called when the edit branch is brought back in sync with main.  This will be called with greater frequency than
   * makeDirty as it fires both for main catching up, and a successful merge back to main.
   * @private
   */
  private makeClean(): void {
    if (this.needsMerge()) {
      // TODO: something useful with read starvation duration
      this.dirtySince = undefined;
    }
  }

  /**
   * Tests if a commit would be part of the next merge from the edit branch
   * @param commit The commit to test
   */
  public contains(commit: BaseCommit<C, D>): boolean {
    return this.refs.has(commit.ref);
  }

  /**
   * The count of commits to the mergeRoot
   */
  public get size(): number {
    return this.refs.size - (isNode(this.root) ? 1 : 0);
  }

  /**
   * The commit that represents the current document and what any new edits
   * (temporary or not) should be based on
   */
  public get head(): BaseCommit<C, D> | undefined {
    return this.temp.commit;
  }

  /**
   * The commit to use for merging back to main any time isDirty is true
   */
  public get mergeHead(): BaseCommit<C, D> | undefined {
    return this.edit.commit;
  }

  /**
   * The commit that is the root when computing a merge of the edit branch with
   * main
   */
  public get mergeRoot(): BaseCommit<C, D> | undefined {
    return this.root.commit;
  }

  /**
   * Resets the merge root of the edit branch
   * @param commit
   */
  public checkout(commit: BaseCommit<C, D>) {
    this.refs.clear();
    const node = new Node(commit);
    this.root = this.edit = this.temp = node;
    this.refs.set(commit.ref, node);
    this.makeClean();
  }

  /**
   * Considers main commits and advances branch's root if possible
   * Expected to be called with every remote main commit in order
   * @param commit all accepted remote commits
   * @return true if head is updated
   */
  public advanceMain(commit: BaseCommit<C, D> | MergeCommit<C, D>): boolean {
    // TODO convert return into reload document trigger
    let previous = this.root;
    let lateMerge = false;
    if (commit.ref === this.merge?.commit?.ref) {
      // attempted merge completed
      const merge = this.merge;
      this.merge = undefined;
      if (!this.refs.has(merge.base)) {
        throw new Error('remote merge out of sequence');
      }
      if (this.mergeHead?.ref === merge.base) {
        // no edits have been made since the merge
        this.checkout(merge.commit);
        console.log(`BRANCH(${this.size}) - merge success ${commit.ref}`);
        return true;
      } else {
        // since the merge provides a connection to main, use the parent in the edit branch as root
        this.root = this.refs.get(merge.base)!;
        lateMerge = true;
      }
    } else if (this.contains(commit)) {
      // a commit in the edit branch is on main,
      this.root = this.refs.get(commit.ref)!;
    } else if (!this.hasEdits()) {
      // there is a new remote commit and no local edit
      this.checkout(commit);
      return true;
    } else {
      // there is a new remote commit that cannot be displayed
      this.makeDirty();
      return false;
    }

    // clean up state based on new root
    let resetEdit = false;
    let resetTemp = this.edit === this.temp;
    while (previous !== this.root) {
      if (isNode(previous)) this.refs.delete(previous.ref);
      if (resetEdit) resetTemp = true;
      if (previous === this.edit) resetEdit = true;
      previous = previous.next!;
    }
    if (resetEdit) {
      this.edit = this.root;
      this.makeClean();
      if (resetTemp) {
        this.temp = this.root;
        if (lateMerge) {
          console.log(`BRANCH(${this.size}) - merge late ${commit.ref}`);
        }
        return true;
      }
    }
    if (lateMerge) {
      console.log(`BRANCH(${this.size}) - merge late ${commit.ref}`);
    }
    return false;
  }

  /**
   * Advances the edit head
   * Expected to be called for every local edit commit in order. Merges should
   * be sent to attemptMerge
   * @param commit the commit to append
   * @param isTemp if the commit is one that can be discarded upon remote updates
   * @return An Iterable of all dirty commits that should be sent to remote
   */
  public advanceBranch(
    commit: BaseCommit<C, D>,
    isTemp?: boolean,
  ): Iterable<BaseCommit<C, D>> {
    if (commit.baseRef !== this.temp.ref)
      throw new Error('out of order commit');
    if (this.refs.has(commit.ref)) throw new Error('cyclic commit');
    if (isMergeCommit(commit)) throw new Error('unexpected merge commit');
    const previous = this.edit;
    const next = this.temp.append(commit);
    this.temp = next;
    if (!isTemp) {
      this.edit = next;
    }
    this.refs.set(commit.ref, next);

    const latest = this.edit;
    return (function* (): Iterable<BaseCommit<C, D>> {
      let node = previous as Node<C, D>;
      while (node !== latest) {
        node = node.next!;
        yield node.commit;
      }
    })();
  }

  /**
   * Records an attempted merge from the edit branch to main.  If the merge
   * comes back as a main commit, the edit branch can adjust accordingly.  There
   * should never be more than one in-flight attempted merge at a time.
   * @param commit A merge commit that joins the edit branch to main
   */
  public attemptMerge(commit: MergeCommit<C, D>): void {
    if (this.root === this.edit || !isNode(this.edit)) {
      throw new Error('invalid merge');
    }
    if (commit.baseRef !== this.edit.ref && commit.mergeRef !== this.edit.ref) {
      throw new Error('out of order merge');
    }
    this.merge = {
      base: this.edit.ref,
      commit,
    };
  }
}

class Origin<C, D> {
  private link: Node<C, D> | undefined;

  public get next(): Node<C, D> | undefined {
    return this.link;
  }

  public append(item: BaseCommit<C, D>): Node<C, D> {
    if (this.link !== undefined) throw new Error('illegal append');
    return (this.link = new Node<C, D>(item));
  }

  public get ref(): string | undefined {
    return undefined;
  }

  public get commit(): BaseCommit<C, D> | undefined {
    return undefined;
  }
}

function isNode<C, D>(node: Origin<C, D> | Node<C, D>): node is Node<C, D> {
  return 'item' in node;
}

class Node<C, D> extends Origin<C, D> {
  constructor(private readonly item: BaseCommit<C, D>) {
    super();
  }

  public get ref(): string {
    return this.item.ref;
  }

  public get commit(): BaseCommit<C, D> {
    return this.item;
  }
}
