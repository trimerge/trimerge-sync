import { mergeHeadNodes } from './merge-nodes';

export type Node<T, M> =
  | {
      type: 'init';
      ref: string;
      value: T;
      editMetadata: M;
    }
  | {
      type: 'edit';
      ref: string;
      base: Node<T, M>;
      value: T;
      editMetadata: M;
    }
  | {
      type: 'merge';
      ref: string;
      parents: Node<T, M>[];
      value: T;
      editMetadata: M;
    };

export class Graph<T, M> {
  private nodes = new Set<Node<T, M>>();
  private branchHeads = new Set<Node<T, M>>();

  constructor(private readonly newId: () => string) {}

  getHeads(): ReadonlySet<Node<T, M>> {
    return this.branchHeads;
  }

  addNode(node: Node<T, M>): Node<T, M> {
    if (this.nodes.has(node)) {
      throw new Error('node already added');
    }
    this.nodes.add(node);
    switch (node.type) {
      case 'init':
        break;
      case 'edit':
        this.branchHeads.delete(node.base);
        break;
      case 'merge':
        for (const parent of node.parents) {
          this.branchHeads.delete(parent);
        }
        break;
    }
    this.branchHeads.add(node);
    return node;
  }

  addInit(value: T, editMetadata: M) {
    return this.addNode({
      type: 'init',
      ref: this.newId(),
      value,
      editMetadata,
    });
  }

  addEdit(base: Node<T, M>, value: T, editMetadata: M) {
    return this.addNode({
      type: 'edit',
      base,
      ref: this.newId(),
      value,
      editMetadata,
    });
  }

  mergeHeads(
    mergeFn: (
      base: Node<T, M> | undefined,
      left: Node<T, M>,
      right: Node<T, M>,
    ) => { value: T; editMetadata: M },
  ): Node<T, M> {
    const merged = mergeHeadNodes(
      Array.from(this.branchHeads),
      (base, left, right) =>
        this.addNode({
          type: 'merge',
          ref: this.newId(),
          parents: [left, right],
          ...mergeFn(base, left, right),
        }),
    );
    if (!merged) {
      throw new Error('no merge result!');
    }
    return merged;
  }
}
