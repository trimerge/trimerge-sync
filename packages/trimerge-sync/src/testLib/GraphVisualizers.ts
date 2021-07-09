import { DiffNode } from '../types';

type BasicGraphItem = {
  graph: string;
  step: string;
  value: any;
};
export function getBasicGraph<EditMetadata>(
  nodes: Iterable<DiffNode<EditMetadata, unknown>>,
  getEditLabel: (node: DiffNode<EditMetadata, unknown>) => string,
  getValue: (node: DiffNode<EditMetadata, unknown>) => any,
): BasicGraphItem[] {
  const result = [];
  for (const node of nodes) {
    const { ref, baseRef, mergeBaseRef, mergeRef, userId } = node;
    if (mergeRef) {
      result.push({
        graph: `(${baseRef} + ${mergeRef}) w/ base=${mergeBaseRef} -> ${ref}`,
        step: `User ${userId}: merge`,
        value: getValue(node),
      });
    } else {
      result.push({
        graph: `${baseRef} -> ${ref}`,
        step: `User ${userId}: ${getEditLabel(node)}`,
        value: getValue(node),
      });
    }
  }
  return result;
}

export function getDotGraph<EditMetadata>(
  nodes: Iterable<DiffNode<EditMetadata, unknown>>,
  getEditLabel: (node: DiffNode<EditMetadata, any>) => string,
  getValue: (node: DiffNode<EditMetadata, any>) => string,
): string {
  const lines: string[] = ['digraph {'];
  for (const node of nodes) {
    lines.push(
      `"${node.ref}" [shape=${
        node.mergeRef ? 'rectangle' : 'ellipse'
      }, label=${JSON.stringify(getValue(node))}]`,
    );
    if (node.baseRef) {
      if (node.mergeRef) {
        lines.push(`"${node.baseRef}" -> "${node.ref}" [label=left]`);
        lines.push(
          `"${node.mergeBaseRef}" -> "${node.ref}" [style=dashed, label=base]`,
        );
        lines.push(`"${node.mergeRef}" -> "${node.ref}" [label=right]`);
      } else {
        lines.push(
          `"${node.baseRef}" -> "${node.ref}" [label=${JSON.stringify(
            `User ${node.userId}: ${getEditLabel(node)}`,
          )}]`,
        );
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}
