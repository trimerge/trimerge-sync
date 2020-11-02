import { Node } from './trimerge-graph';

type Visitor<T, M> = {
  node: Node<T, M>;
  current: Set<Node<T, M>>;
  seenRefs: Set<string>;
};

export type MergeNodeFn<T, M> = (
  base: Node<T, M> | undefined,
  left: Node<T, M>,
  right: Node<T, M>,
  depth: number,
) => Node<T, M>;

/**
 * This function walks up the tree starting at the nodes in a breadth-first manner, merging nodes as common ancestors are found.
 *
 * Those merged nodes then continue to be merged together until there is just one head node left.
 *
 * If there are completely un-connected nodes, these will be merged with base === undefined
 */
export function mergeHeadNodes<T, M>(
  originNodes: Node<T, M>[],
  merge: MergeNodeFn<T, M>,
  sortOrder: (a: Node<T, M>, b: Node<T, M>) => number = (a, b) =>
    a.ref < b.ref ? -1 : 1,
): Node<T, M> | undefined {
  originNodes.sort(sortOrder);
  const visitors = originNodes.map(
    (node): Visitor<T, M> => ({
      node,
      current: new Set([node]),
      seenRefs: new Set([node.ref]),
    }),
  );
  let depth = 0;

  function mergeLeaves(i: number, j: number, base?: Node<T, M>) {
    const a = visitors[i];
    const b = visitors[j];
    const [left, right] =
      sortOrder(a.node, b.node) <= 0 ? [a.node, b.node] : [b.node, a.node];
    visitors[i] = {
      node: merge(base, left, right, depth),
      current: new Set([...a.current, ...b.current]),
      seenRefs: new Set([...a.seenRefs, ...b.seenRefs]),
    };
    visitors.splice(j, 1);
  }

  // Use inner function because we want to be able to break out of 3 levels of for loop
  function iterate(): boolean {
    let hasNodes = false;
    for (let i = 0; i < visitors.length; i++) {
      const leaf = visitors[i];
      const nextNodes = new Set<Node<T, M>>();
      for (const node of leaf.current) {
        for (let j = 0; j < visitors.length; j++) {
          if (j !== i && visitors[j].seenRefs.has(node.ref)) {
            mergeLeaves(i, j, node);
            return true;
          }
        }
        if (node.base !== undefined) {
          nextNodes.add(node.base);
          leaf.seenRefs.add(node.base.ref);
          hasNodes = true;
        }
        if (node.base2 !== undefined) {
          nextNodes.add(node.base2);
          leaf.seenRefs.add(node.base2.ref);
          hasNodes = true;
        }
        leaf.current = nextNodes;
      }
    }
    depth++;
    return hasNodes;
  }

  while (iterate());

  if (visitors.length > 1) {
    visitors.sort((a, b) => sortOrder(a.node, b.node));
    while (visitors.length > 1) {
      mergeLeaves(0, 1);
    }
  }
  return visitors[0]?.node;
}
