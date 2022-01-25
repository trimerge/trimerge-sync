import { asCommitRefs } from '../lib/Commits';
import { Commit, isMergeCommit } from '../types';

type BasicGraphItem = {
  graph: string;
  step: string;
  value: any;
};
export function getBasicGraph<EditMetadata>(
  commits: Iterable<Commit<EditMetadata, unknown>>,
  getEditLabel: (commit: Commit<EditMetadata, unknown>) => string,
  getValue: (commit: Commit<EditMetadata, unknown>) => any,
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

export function getDotGraph<EditMetadata>(
  commits: Iterable<Commit<EditMetadata, unknown>>,
  getEditLabel: (commit: Commit<EditMetadata, any>) => string,
  getValue: (commit: Commit<EditMetadata, any>) => string,
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
        lines.push(`"${commit.mergeRef}" -> "${commit.ref}" [label=right]`);
      } else {
        lines.push(
          `"${commit.baseRef}" -> "${commit.ref}" [label=${JSON.stringify(
            getEditLabel(commit),
          )}]`,
        );
      }
    }
  }
  lines.push('}');
  return lines.join('\n');
}
