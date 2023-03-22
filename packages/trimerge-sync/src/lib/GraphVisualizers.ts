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

type NodeType = 'edit' | 'merge' | 'meta' | 'placeholder';

interface Node {
  get id(): string;
  get label(): string;
  get editLabel(): string;
  get baseRef(): string | undefined;
  get mergeRef(): string | undefined;
  get nodeType(): NodeType;
  get userId(): string | undefined;
  get isMain(): boolean;
  isReferenced: boolean;
}

class CommitNode<CommitMetadata = unknown> implements Node {
  isReferenced = false;
  constructor(
    readonly commit: Commit<CommitMetadata>,
    private readonly _getEditLabel: (
      commit: Commit<CommitMetadata, any>,
    ) => string,
    private readonly _getValue: (commit: Commit<CommitMetadata, any>) => string,
    private readonly _getUserId: (
      commit: Commit<CommitMetadata, any>,
    ) => string,
    private readonly _isMain: (commit: Commit<CommitMetadata, any>) => boolean,
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

  get userId(): string | undefined {
    return this._getUserId(this.commit);
  }
  get isMain(): boolean {
    return this._isMain(this.commit);
  }
}

/** PlaceholderNode is used to represent refs for which we don't have an underlying commit.
 *  This is useful for cases where we want to render a subset of the commit graph.
 */
class PlaceholderNode implements Node {
  isReferenced = true;
  constructor(private readonly ref: string) {}

  get id(): string {
    return this.ref;
  }

  get label(): string {
    return this.ref;
  }
  get editLabel(): string {
    return '';
  }
  get baseRef(): string | undefined {
    return undefined;
  }
  get mergeRef(): string | undefined {
    return undefined;
  }

  nodeType: NodeType = 'placeholder';

  get userId(): string | undefined {
    return undefined;
  }
  get isMain(): boolean {
    return false;
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
      nodeMap.set(child.id, node);
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

class MetaNode<CommitMetadata = unknown> implements Node {
  isReferenced = false;
  constructor(readonly children: CommitNode<CommitMetadata>[] = []) {
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
    return `${this.children[0].label}:${
      this.children[this.children.length - 1].label
    } (${this.children.length} commits)`;
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

  get userId(): string | undefined {
    return this.children[0].userId;
  }

  get isMain(): boolean {
    for (const child of this.children) {
      if (child.isMain) {
        return true;
      }
    }
    return false;
  }
}

const COLORS = [
  'azure',
  'beige',
  'bisque',
  'gainsboro',
  'grey',
  'lightcyan',
  'lightpink',
];

function getDotGraphFromNodes<CommitMetadata>(
  nodes: Map<string, Node>,
  { nodeLimit }: { nodeLimit?: number } = {},
): {
  graph: string;
  commits: Commit<CommitMetadata, unknown>[];
} {
  const lines: string[] = ['digraph {'];
  const renderedNodes = new Set<Node>();
  let nextColorIdx = 0;
  const userColors = new Map<string | undefined, string>();
  const commits: Commit<CommitMetadata, unknown>[] = [];
  for (const node of nodes.values()) {
    // The structure of the map is that multiple commit refs can refer to a single node object
    // so we only want to render each node once

    if (renderedNodes.has(node)) {
      continue;
    }

    renderedNodes.add(node);

    if (!userColors.has(node.userId)) {
      const color = COLORS[nextColorIdx % COLORS.length];
      nextColorIdx++;
      userColors.set(node.userId, color);
    }

    const color = userColors.get(node.userId);

    // keep track of the commits that the nodes in the digraph represent.
    // if the node is a meta node, we just say that it represents the last commit.
    let representedCommit: Commit<CommitMetadata, unknown> | undefined;

    switch (node.nodeType) {
      case 'meta':
        const metaNode = node as MetaNode<CommitMetadata>;
        representedCommit =
          metaNode.children[metaNode.children.length - 1].commit;
        break;
      case 'edit':
      case 'merge':
        representedCommit = (node as CommitNode<CommitMetadata>).commit;
        break;
    }

    if (representedCommit) {
      commits.push(representedCommit);
    }

    lines.push(
      `"${node.id}" [shape=${
        node.nodeType === 'merge' ? 'rectangle' : 'ellipse'
      }, label="${node.label}", color=${
        node.isMain ? 'red' : 'black'
      }, fillcolor=${color}, style=${
        node.nodeType === 'placeholder' ? 'dashed' : 'filled'
      }${representedCommit ? `, id="${representedCommit.ref}"` : ''}];`,
    );

    if (node.baseRef) {
      let baseNode = nodes.get(node.baseRef);
      if (!baseNode) {
        baseNode = new PlaceholderNode(node.baseRef);
      }
      if (node.mergeRef) {
        const mergeNode = nodes.get(node.mergeRef);

        lines.push(`"${baseNode.id}" -> "${node.id}" [label=left]`);
        if (mergeNode) {
          lines.push(`"${mergeNode.id}" -> "${node.id}" [label=right]`);
        } else {
          console.warn('mergeNode not found: ', node.mergeRef);
        }
      } else {
        lines.push(
          `"${baseNode.id}" -> "${node.id}" [label="${node.editLabel}"]`,
        );
      }
    }
  }
  lines.push('}');
  return { graph: lines.join('\n'), commits };
}

function getNodeMapFromNodeArray(nodes: Node[]): Map<string, Node> {
  const nodeMap = new Map<string, Node>();
  for (const node of nodes) {
    updateNodeMap(nodeMap, node);
  }
  return nodeMap;
}

function getTruncatedNodeMap<CommitMetadata>(
  nodeMap: Map<string, Node>,
  commits: Iterable<Commit<CommitMetadata, unknown>>,
  nodeLimit: number,
  offset: number,
): Map<string, Node> {
  // construct an ordered list of nodes to render
  const reversedCommits = [...commits].reverse();

  // ordered list of nodes encountered when iterating backwards through commits
  const nodeArray: Node[] = [];
  const targetNodeIndex = offset + nodeLimit;
  let currentNodeIndex = 0;
  for (const { ref } of reversedCommits) {
    const node = nodeMap.get(ref);
    if (!node) {
      throw new Error(`no node for commit ref ${ref}`);
    }

    if (!nodeArray.includes(node)) {
      nodeArray.push(node);
      currentNodeIndex++;
      if (currentNodeIndex >= targetNodeIndex) {
        break;
      }
    }
  }

  return getNodeMapFromNodeArray(nodeArray.slice(offset));
}

/**
 * This function accepts a list of commits and creates a graphviz DOT digraph.
 * It uses getEditLabel to label the edges of the graph and getValue to label the nodes.
 * It uses getUserId to map a commit to its creator and color the nodes based on the creator.
 * It will use isMain to highlight commits that are on the mainline.
 *
 * Chains of nodes created by the same user are grouped together.
 */
export function getDotGraph<CommitMetadata>(
  commits: Iterable<Commit<CommitMetadata, unknown>>,
  getEditLabel: (commit: Commit<CommitMetadata, any>) => string,
  getValue: (commit: Commit<CommitMetadata, any>) => string,
  getUserId: (commit: Commit<CommitMetadata, any>) => string,
  isMain: (commit: Commit<CommitMetadata, any>) => boolean,
  { nodeLimit, offset }: { nodeLimit?: number; offset: number } = {
    nodeLimit: undefined,
    offset: 0,
  },
): { graph: string; commits: Commit<CommitMetadata, unknown>[] } {
  const nodeMap = new Map<string, Node>();

  for (const commit of commits) {
    let node: Node = new CommitNode<CommitMetadata>(
      commit,
      getEditLabel,
      getValue,
      getUserId,
      isMain,
    );

    // see if we can merge this into an existing node.
    if (commit.baseRef) {
      let baseNode = nodeMap.get(commit.baseRef);
      if (!baseNode) {
        baseNode = new PlaceholderNode(commit.baseRef);
        nodeMap.set(commit.baseRef, baseNode);
      }
      switch (baseNode.nodeType) {
        case 'edit':
          if (
            baseNode.userId === node.userId &&
            node.nodeType !== 'merge' &&
            !baseNode.isReferenced
          ) {
            node = new MetaNode([baseNode as CommitNode, node as CommitNode]);
            nodeMap.set(commit.baseRef, node);
          }
          break;
        case 'meta':
          if (isLastChild(baseNode as MetaNode, commit.baseRef)) {
            if (baseNode.userId === node.userId && node.nodeType !== 'merge') {
              (baseNode as MetaNode).children.push(node as CommitNode);
              node = baseNode;
            }
          } else {
            splitMetaNode(baseNode as MetaNode, commit.baseRef, nodeMap);
          }
          break;
      }
      baseNode.isReferenced = true;
    }

    if (isMergeCommit(commit)) {
      let mergeNode = nodeMap.get(commit.mergeRef);

      if (!mergeNode) {
        mergeNode = new PlaceholderNode(commit.mergeRef);
        nodeMap.set(commit.mergeRef, mergeNode);
      }

      // Allow for the possibility that we don't have the
      // commit that corresponds to the mergeRef.
      if (mergeNode) {
        if (mergeNode.nodeType === 'meta') {
          splitMetaNode(mergeNode as MetaNode, commit.mergeRef, nodeMap);
        }

        mergeNode = nodeMap.get(commit.mergeRef);
        if (!mergeNode) {
          throw new Error(`mergeNode not found: ${commit.mergeRef}`);
        }
        mergeNode.isReferenced = true;
      }
    }

    nodeMap.set(commit.ref, node);
  }

  const truncatedNodeMap =
    nodeLimit !== undefined
      ? getTruncatedNodeMap(nodeMap, commits, nodeLimit, offset)
      : nodeMap;

  return getDotGraphFromNodes(truncatedNodeMap);
}
