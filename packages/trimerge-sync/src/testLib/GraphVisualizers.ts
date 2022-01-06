import { asCommitRefs } from '../lib/Commits';
import { Commit, CommitBody, isMergeCommit } from '../types';

type BasicGraphItem = {
  graph: string;
  step: string;
  value: any;
};
export function getBasicGraph<EditMetadata>(
  commits: Iterable<Commit<EditMetadata, unknown, unknown>>,
  getEditLabel: (commit: CommitBody<EditMetadata, unknown>) => string,
  getValue: (commit: CommitBody<EditMetadata, unknown>) => any,
): BasicGraphItem[] {
  const result = [];
  for (const { body } of commits) {
    const userId = body.userId;
    const { ref, baseRef, mergeBaseRef, mergeRef } = asCommitRefs(body);
    if (mergeRef) {
      result.push({
        graph: `(${baseRef} + ${mergeRef}) w/ base=${mergeBaseRef} -> ${ref}`,
        step: `User ${userId}: merge`,
        value: getValue(body),
      });
    } else {
      result.push({
        graph: `${baseRef} -> ${ref}`,
        step: `User ${userId}: ${getEditLabel(body)}`,
        value: getValue(body),
      });
    }
  }
  return result;
}

export function getDotGraph<EditMetadata>(
  commits: Iterable<CommitBody<EditMetadata, unknown>>,
  getEditLabel: (commit: CommitBody<EditMetadata, any>) => string,
  getValue: (commit: CommitBody<EditMetadata, any>) => string,
): string {
  const lines: string[] = ['digraph {'];
  for (const commit of commits) {
    lines.push(
      `"${commit.ref}" [shape=${
        isMergeCommit(commit) ? 'rectangle' : 'ellipse'
      }, label=${JSON.stringify(getValue(commit))}]`,
    );
    if (commit.baseRef) {
      if (isMergeCommit(commit)) {
        lines.push(`"${commit.baseRef}" -> "${commit.ref}" [label=left]`);
        lines.push(
          `"${commit.mergeBaseRef}" -> "${commit.ref}" [style=dashed, label=base]`,
        );
        lines.push(`"${commit.mergeRef}" -> "${commit.ref}" [label=right]`);
      } else {
        lines.push(
          `"${commit.baseRef}" -> "${commit.ref}" [label=${JSON.stringify(
            `User ${commit.userId}: ${getEditLabel(commit)}`,
          )}]`,
        );
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}
