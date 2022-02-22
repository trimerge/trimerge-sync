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

class CommitNode<CommitMetadata = unknown> implements Node {
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

// if there's just a single node in a list just return the node,
function getNodeFromNodeArray(nodes: CommitNode[]): Node;
function getNodeFromNodeArray(nodes: undefined): undefined;
function getNodeFromNodeArray(
  nodes: CommitNode[] | undefined,
): Node | undefined {
  if (!nodes) {
    return undefined;
  }

  if (nodes.length === 1) {
    return nodes[0];
  }

  return new MetaNode(nodes);
}

function updateNodeMap(nodeMap: Map<string, Node>, node: Node): void {
  if (node instanceof MetaNode) {
    for (const child of node.children) {
      nodeMap.set(child.id, child);
    }
  } else {
    nodeMap.set(node.id, node);
  }
}

function splitMetaNode(
  node: MetaNode,
  ref: string,
  nodeMap: Map<string, Node>,
) {
  let before: CommitNode[] | undefined;
  let splitNode: CommitNode<unknown> | undefined;
  let after: CommitNode[] | undefined;

  for (const child of node.children) {
    if (child.id === ref) {
      splitNode = child;
    } else {
      if (!splitNode) {
        if (!before) {
          before = [];
        }
        before.push(child);
      } else {
        if (!after) {
          after = [];
        }
        after.push(child);
      }
    }
  }

  if (before) {
    updateNodeMap(nodeMap, getNodeFromNodeArray(before));
  }

  if (splitNode) {
    updateNodeMap(nodeMap, splitNode);
  }

  if (after) {
    updateNodeMap(nodeMap, getNodeFromNodeArray(after));
  }
}

function isLastChild(node: MetaNode, ref: string): boolean {
  // TODO: maintain tail of meta node?
  return (
    node.children.findIndex((child) => child.id === ref) ===
    node.children.length - 1
  );
}

class MetaNode implements Node {
  // potentially this should be nodes
  constructor(readonly children: CommitNode<unknown>[] = []) {
    if (children.length < 2) {
      throw new Error('MetaNode must have at least 2 children');
    }
  }

  get id(): string {
    return `${this.children[0].id}:${
      this.children[this.children.length - 1].id
    }`;
  }
  get label(): string {
    return `${this.children.length} commits`;
  }

  get editLabel(): string {
    return '';
  }
  get baseRef(): string | undefined {
    return this.children[0].baseRef;
  }
  get mergeRef(): string | undefined {
    // there should never be a merge commit in the meta node
    return undefined;
  }

  get nodeType(): NodeType {
    return 'meta';
  }
}

export function getDotGraphFromNodes(nodes: Map<string, Node>): string {
  const lines: string[] = ['digraph {'];
  for (const node of nodes.values()) {
    lines.push(
      `"${node.id}" [shape=${
        node.nodeType === 'merge' ? 'rectangle' : 'ellipse'
      }, label="${node.label}"]`,
    );
    if (node.baseRef) {
      const baseNode = nodes.get(node.baseRef);
      if (!baseNode) {
        throw new Error(`baseRef ${node.baseRef} not found`);
      }
      if (node.mergeRef) {
        const mergeNode = nodes.get(node.mergeRef);
        if (!mergeNode) {
          throw new Error(`mergeRef ${node.mergeRef} not found`);
        }
        lines.push(`"${node.baseRef}" -> "${baseNode.id}" [label=left]`);
        lines.push(`"${node.mergeRef}" -> "${mergeNode.id}" [label=right]`);
      } else {
        lines.push(
          `"${node.baseRef}" -> "${baseNode.id}" [label="${node.editLabel}"]`,
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
  const nodeMap = new Map<string, Node>();
  for (const commit of commits) {
    let node: Node = new CommitNode<CommitMetadata>(
      commit,
      getEditLabel,
      getValue,
    );

    if (isMergeCommit(commit)) {
      continue;
    }

    if (commit.baseRef) {
      const baseNode = nodeMap.get(commit.baseRef);
      if (!baseNode) {
        throw new Error('commits should be partially ordered');
      }
      switch (baseNode.nodeType) {
        case 'edit':
          node = new MetaNode([baseNode as CommitNode, node as CommitNode]);
          break;
        case 'meta':
          if (isLastChild(baseNode as MetaNode, commit.baseRef)) {
            (baseNode as MetaNode).children.push(node as CommitNode);
          } else {
            splitMetaNode(baseNode as MetaNode, commit.baseRef, nodeMap);
          }
      }
    }

    nodeMap.set(commit.ref, node);
  }
  return getDotGraphFromNodes(nodeMap);
}
