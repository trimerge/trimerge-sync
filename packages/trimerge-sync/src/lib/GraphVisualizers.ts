import { asCommitRefs } from '../lib/Commits';
import { Commit, isMergeCommit } from '../types';

type BasicGraphItem = {
  graph: string;
  step: string;
  value: any;
};
export function getBasicGraph<CommitMetadata>(
  commits: Iterable<Commit<CommitMetadata, unknown>>,
  getEditLabel: (commit: Commit<CommitMetadata, unknown>) => string,
  getValue: (commit: Commit<CommitMetadata, unknown>) => any,
): BasicGraphItem[] {
  const result = [];
  for (const commit of commits) {
    const { ref, baseRef, mergeRef } = asCommitRefs(commit);
    if (mergeRef) {
      result.push({
        graph: `(${baseRef} + ${mergeRef}) w/ base=${'unknown'} -> ${ref}`,
        step: `merge`,
        value: getValue(commit),
      });
    } else {
      result.push({
        graph: `${baseRef} -> ${ref}`,
        step: getEditLabel(commit),
        value: getValue(commit),
      });
    }
  }
  return result;
}

type NodeType = 'edit' | 'merge' | 'meta';

interface Node {
  get id(): string;
  get label(): string;
  get editLabel(): string;
  get baseRef(): string | undefined;
  get mergeRef(): string | undefined;
  get nodeType(): NodeType;
}

class CommitNode<CommitMetadata> implements Node {
  constructor(
    private readonly commit: Commit<CommitMetadata>,
    private readonly _getEditLabel: (
      commit: Commit<CommitMetadata, any>,
    ) => string,
    private readonly _getValue: (commit: Commit<CommitMetadata, any>) => string,
  ) {}

  get id(): string {
    return this.commit.ref;
  }

  get label(): string {
    return this._getValue(this.commit);
  }
  get editLabel(): string {
    return this._getEditLabel(this.commit);
  }
  get baseRef(): string | undefined {
    return this.commit.baseRef;
  }
  get mergeRef(): string | undefined {
    if (isMergeCommit(this.commit)) {
      return this.commit.mergeRef;
    }
    return undefined;
  }

  get nodeType(): NodeType {
    return isMergeCommit(this.commit) ? 'merge' : 'edit';
  }
}

export function getDotGraphFromNodes(nodes: Iterable<Node>): string {
  const lines: string[] = ['digraph {'];
  for (const node of nodes) {
    lines.push(
      `"${node.id}" [shape=${
        node.nodeType === 'merge' ? 'rectangle' : 'ellipse'
      }, label="${node.label}"]`,
    );
    if (node.baseRef) {
      if (node.mergeRef) {
        lines.push(`"${node.baseRef}" -> "${node.id}" [label=left]`);
        lines.push(`"${node.mergeRef}" -> "${node.id}" [label=right]`);
      } else {
        lines.push(
          `"${node.baseRef}" -> "${node.id}" [label="${node.editLabel}"]`,
        );
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}

export function getDotGraph<CommitMetadata>(
  commits: Iterable<Commit<CommitMetadata, unknown>>,
  getEditLabel: (commit: Commit<CommitMetadata, any>) => string,
  getValue: (commit: Commit<CommitMetadata, any>) => string,
): string {
  const nodes: Node[] = [];
  for (const commit of commits) {
    nodes.push(new CommitNode<CommitMetadata>(commit, getEditLabel, getValue));
  }
  return getDotGraphFromNodes(nodes);
}
