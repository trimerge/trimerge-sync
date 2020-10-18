import { Graph, Node } from './graph';

type TrimergeNodeFn<T> = (
  base: T | undefined,
  left: T | undefined,
  right: T | undefined,
) => T;
type MetadataFn<T, M> = (
  base: Node<T, M> | undefined,
  left: Node<T, M> | undefined,
  right: Node<T, M> | undefined,
) => M;

export function merge<T, M>(
  graph: Graph<T, M>,
  trimerge: TrimergeNodeFn<T>,
  mergeMetadata: MetadataFn<T, M>,
  ...nodes: Node<T, M>[]
) {
  // TODO: use commonAncestor
  return nodes.reduce((left, right) => {
    const base = commonParent<T, M>(left, right)?.parent;
    const mergedValue = trimerge(base?.value, left.value, right.value);
    return graph.merge(mergedValue, mergeMetadata(base, left, right), [
      left,
      right,
    ]);
  });
}

export function commonParent<T, M>(
  left: Node<T, M>,
  right: Node<T, M>,
): { parent: Node<T, M>; depth: number } | undefined {
  let nodes = [left, right];
  const seenRefs = new Set<string>([]);
  let depth = 0;
  while (nodes.length > 0) {
    const nextNodes = [];
    for (const node of nodes) {
      if (seenRefs.has(node.ref)) {
        return { parent: node, depth };
      }
      seenRefs.add(node.ref);
      switch (node.type) {
        case 'edit':
          nextNodes.push(node.base);
          break;
        case 'merge':
          nextNodes.push(...node.parents);
          break;
      }
    }
    nodes = nextNodes;
    depth++;
  }
  return undefined;
}

type Ancestor<T, M> = {
  base: Node<T, M>;
  left: Node<T, M>;
  right: Node<T, M>;
  depth: number;
};

export function* commonAncestor<T, M>(
  originNodes: Node<T, M>[],
): IterableIterator<Ancestor<T, M>> {
  type Leaf = {
    index: number;
    originNode: Node<T, M>;
    nodes: Set<Node<T, M>>;
    seenRefs: Set<string>;
  };
  const leaves: Leaf[] = originNodes.map((node, index) => ({
    index,
    originNode: node,
    nodes: new Set([node]),
    seenRefs: new Set<string>([node.ref]),
  }));
  let depth = 0;

  function iterate(): Ancestor<T, M> | boolean {
    let hasNodes = false;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      const nextNodes = new Set<Node<T, M>>();
      for (const node of leaf.nodes) {
        for (let j = 0; j < leaves.length; j++) {
          if (j === i) {
            continue;
          }
          const otherLeaf = leaves[j];
          if (otherLeaf.seenRefs.has(node.ref)) {
            leaves[i] = {
              index: Math.min(leaf.index, otherLeaf.index),
              originNode: node,
              nodes: new Set([...leaf.nodes, ...otherLeaf.nodes]),
              seenRefs: new Set([...leaf.seenRefs, ...otherLeaf.seenRefs]),
            };
            leaves.splice(j, 1);
            if (leaf.index < otherLeaf.index) {
              return {
                base: node,
                left: leaf.originNode,
                right: otherLeaf.originNode,
                depth,
              };
            } else {
              return {
                base: node,
                left: otherLeaf.originNode,
                right: leaf.originNode,
                depth,
              };
            }
          }
        }
        switch (node.type) {
          case 'edit':
            nextNodes.add(node.base);
            leaf.seenRefs.add(node.base.ref);
            hasNodes = true;
            break;
          case 'merge':
            for (const parent of node.parents) {
              nextNodes.add(parent);
              leaf.seenRefs.add(parent.ref);
              hasNodes = true;
            }
            break;
        }
        leaf.nodes = nextNodes;
      }
    }
    return hasNodes;
  }

  while (leaves.length > 0) {
    const result = iterate();
    if (result === false) {
      break;
    }
    if (result === true) {
      depth++;
    } else {
      yield result;
    }
  }
}
