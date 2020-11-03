import { mergeHeadNodes } from './merge-nodes';

export type Node<T, M> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  value: T;
  editMetadata: M;
};

export type MergeHeadsResult<T, M> = { value: T; editMetadata: M };
export type MergeHeadNodesFn<T, M> = (
  base: Node<T, M> | undefined,
  left: Node<T, M>,
  right: Node<T, M>,
) => MergeHeadsResult<T, M>;

export class TrimergeGraph<T, M> {
  private nodes = new Map<string, Node<T, M>>();
  private branchHeads = new Set<Node<T, M>>();

  constructor(private readonly newId: () => string) {}

  getHeads(): ReadonlySet<Node<T, M>> {
    return this.branchHeads;
  }

  getNodes(): ReadonlyMap<string, Node<T, M>> {
    return this.nodes;
  }

  private getNode(ref: string): Node<T, M> {
    const node = this.nodes.get(ref);
    if (!node) {
      throw new Error(`unknown ref "${ref}"`);
    }
    return node;
  }

  protected addNode(node: Node<T, M>): Node<T, M> {
    if (this.nodes.has(node.ref)) {
      throw new Error(`node ref "${node.ref}" already added`);
    }
    this.nodes.set(node.ref, node);
    if (node.baseRef !== undefined) {
      this.branchHeads.delete(this.getNode(node.baseRef));
    }
    if (node.baseRef2 !== undefined) {
      this.branchHeads.delete(this.getNode(node.baseRef2));
    }
    this.branchHeads.add(node);
    return node;
  }

  addInit(value: T, editMetadata: M) {
    return this.addNode({ ref: this.newId(), value, editMetadata });
  }

  addEdit(base: Node<T, M>, value: T, editMetadata: M) {
    return this.addNode({
      baseRef: base.ref,
      ref: this.newId(),
      value,
      editMetadata,
    });
  }

  mergeHeads(mergeFn: MergeHeadNodesFn<T, M>): Node<T, M> {
    const merged = mergeHeadNodes<Node<T, M>>(
      Array.from(this.branchHeads),
      (ref) => this.getNode(ref),
      (base, left, right) =>
        this.addNode({
          ref: this.newId(),
          baseRef: left.ref,
          baseRef2: right.ref,
          ...mergeFn(base, left, right),
        }),
    );
    if (!merged) {
      throw new Error('no merge result!');
    }
    return merged;
  }
}
