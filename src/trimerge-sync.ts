import { Node, TrimergeGraph } from './trimerge-graph';

export type Step<M, D> = {
  ref: string;
  baseRef?: string;
  baseRef2?: string;
  delta: D;
  editMetadata: M;
};

export class TrimergeDiffGraph<T, M, D> extends TrimergeGraph<T, M> {
  constructor(
    private readonly diff: (prior: T | undefined, value: T) => D,
    private readonly refHash: (
      baseRef: string | undefined,
      baseRef2: string | undefined,
      delta: D,
      editMetadata: M,
    ) => string,
  ) {
    super(() => '');
  }

  protected addNode(node: Node<T, M>): Node<T, M> {
    const { value, base, base2, editMetadata } = node;
    const baseValue = base?.value;
    const delta = this.diff(baseValue, value);
    const baseRef = base?.ref;
    const baseRef2 = base2?.ref;
    const ref = this.refHash(baseRef, baseRef2, delta, editMetadata);
    const step: Step<M, D> = { ref, delta, editMetadata };
    if (baseRef) {
      step.baseRef = baseRef;
    }
    if (baseRef2) {
      step.baseRef2 = baseRef2;
    }
    return super.addNode({ ...node, ref });
  }
}
