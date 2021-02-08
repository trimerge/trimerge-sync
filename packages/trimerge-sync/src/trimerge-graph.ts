import { mergeHeadNodes } from './merge-nodes';

export type Node<T, M> = {
  ref: string;
  baseRef?: string;
  mergeRef?: string;
  mergeBaseRef?: string;
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
    if (node.mergeRef !== undefined) {
      this.branchHeads.delete(this.getNode(node.mergeRef));
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

  mergeHeads(mergeFn: MergeHeadNodesFn<T, M>): string {
    const merged = mergeHeadNodes<Node<T, M>>(
      Array.from(this.branchHeads).map(({ ref }) => ref),
      (ref) => this.getNode(ref),
      (baseRef, leftRef, rightRef) =>
        this.addNode({
          ref: this.newId(),
          baseRef: leftRef,
          mergeRef: rightRef,
          mergeBaseRef: baseRef,
          ...mergeFn(
            baseRef !== undefined ? this.getNode(baseRef) : undefined,
            this.getNode(leftRef),
            this.getNode(rightRef),
          ),
        }).ref,
    );
    if (merged === undefined) {
      throw new Error('no merge result!');
    }
    return merged;
  }
}
