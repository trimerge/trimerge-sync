import { MemoryStore } from './MemoryStore';
import { DiffNode } from '../TrimergeSyncBackend';

export function getBasicGraph<EditMetadata>(
  store: MemoryStore<EditMetadata, any, any>,
  getEditLabel: (node: DiffNode<EditMetadata, any>) => string,
  getValue: (node: DiffNode<EditMetadata, any>) => any,
) {
  return store.getNodes().map((node) => {
    const { ref, baseRef, mergeBaseRef, mergeRef, userId } = node;
    if (mergeRef) {
      return {
        graph: `(${baseRef} + ${mergeRef}) w/ base=${mergeBaseRef} -> ${ref}`,
        step: `User ${userId}: merge`,
        value: getValue(node),
      };
    }
    return {
      graph: `${baseRef} -> ${ref}`,
      step: `User ${userId}: ${getEditLabel(node)}`,
      value: getValue(node),
    };
  });
}
export function getDotGraph<EditMetadata>(
  store: MemoryStore<EditMetadata, any, any>,
  getEditLabel: (node: DiffNode<EditMetadata, any>) => string,
  getValue: (node: DiffNode<EditMetadata, any>) => string,
): string {
  const lines: string[] = ['digraph {'];
  for (const node of store.getNodes()) {
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
