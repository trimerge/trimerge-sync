import { CommitDoc, DocAndMetadata, MergeHelpers } from './differ';
import { mergeHeads, SortRefsFn } from './merge-heads';

export type MergeResult<LatestDoc, CommitMetadata> = {
  temp?: boolean;
} & DocAndMetadata<LatestDoc, CommitMetadata>;

export type MergeDocFn<LatestDoc, CommitMetadata> = (
  base: CommitDoc<LatestDoc, CommitMetadata> | undefined,
  left: CommitDoc<LatestDoc, CommitMetadata>,
  right: CommitDoc<LatestDoc, CommitMetadata>,
) => MergeResult<LatestDoc, CommitMetadata>;

export function mergeAllHeads<LatestDoc, CommitMetadata>(
  headRefs: string[],
  {
    computeLatestDoc,
    getCommitInfo,
    addMerge,
  }: MergeHelpers<LatestDoc, CommitMetadata>,
  sortRefs: SortRefsFn,
  merge: MergeDocFn<LatestDoc, CommitMetadata>,
): void {
  mergeHeads(
    headRefs,
    sortRefs,
    getCommitInfo,
    (baseRef, leftRef, rightRef) => {
      const migratedBase =
        baseRef !== undefined ? computeLatestDoc(baseRef) : undefined;
      const migratedLeft = computeLatestDoc(leftRef);
      const migratedRight = computeLatestDoc(rightRef);

      const {
        doc,
        metadata,
        temp = true,
      } = merge(migratedBase, migratedLeft, migratedRight);

      return addMerge(doc, metadata, temp, migratedLeft.ref, migratedRight.ref);
    },
  );
}
