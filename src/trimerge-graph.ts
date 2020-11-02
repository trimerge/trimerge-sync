import { mergeHeadNodes } from './merge-nodes';

export type Node<T, M> = {
  ref: string;
  base?: Node<T, M>;
  base2?: Node<T, M>;
  value: T;
  editMetadata: M;
};

export type MergeHeadsResult<T, M> = { value: T; editMetadata: M };
export type MergeHeadsFn<T, M> = (
  base: Node<T, M> | undefined,
  left: Node<T, M>,
  right: Node<T, M>,
) => MergeHeadsResult<T, M>;

export class TrimergeGraph<T, M> {
  private nodes = new Set<Node<T, M>>();
  private branchHeads = new Set<Node<T, M>>();

  constructor(private readonly newId: () => string) {}

  getHeads(): ReadonlySet<Node<T, M>> {
    return this.branchHeads;
  }

  protected addNode(node: Node<T, M>): Node<T, M> {
    if (this.nodes.has(node)) {
      throw new Error('node already added');
    }
    this.nodes.add(node);
    if (node.base !== undefined) {
      this.branchHeads.delete(node.base);
    }
    if (node.base2 !== undefined) {
      this.branchHeads.delete(node.base2);
    }
    this.branchHeads.add(node);
    return node;
  }

  addInit(value: T, editMetadata: M) {
    return this.addNode({ ref: this.newId(), value, editMetadata });
  }

  addEdit(base: Node<T, M>, value: T, editMetadata: M) {
    return this.addNode({
      base,
      ref: this.newId(),
      value,
      editMetadata,
    });
  }

  mergeHeads(mergeFn: MergeHeadsFn<T, M>): Node<T, M> {
    const merged = mergeHeadNodes(
      Array.from(this.branchHeads),
      (base, left, right) =>
        this.addNode({
          ref: this.newId(),
          base: left,
          base2: right,
          ...mergeFn(base, left, right),
        }),
    );
    if (!merged) {
      throw new Error('no merge result!');
    }
    return merged;
  }
}
