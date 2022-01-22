import { MergeAllBranchesFn, CommitDoc, DocAndMetadata } from './differ';
import { mergeHeads, SortRefsFn } from './merge-heads';

export type MergeResult<LatestDoc, EditMetadata> = {
  temp?: boolean;
} & DocAndMetadata<LatestDoc, EditMetadata>;

export type MergeDocFn<LatestDoc, EditMetadata> = (
  base: CommitDoc<LatestDoc, EditMetadata> | undefined,
  left: CommitDoc<LatestDoc, EditMetadata>,
  right: CommitDoc<LatestDoc, EditMetadata>,
) => MergeResult<LatestDoc, EditMetadata>;

export function makeAutoBranchMerger<LatestDoc, EditMetadata>(
  sortRefs: SortRefsFn,
  merge: MergeDocFn<LatestDoc, EditMetadata>,
): MergeAllBranchesFn<LatestDoc, EditMetadata> {
  return (headRefs, { addMerge, getCommitInfo, computeLatestDoc }) => {
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

        return addMerge(
          doc,
          metadata,
          temp,
          migratedLeft.ref,
          migratedRight.ref,
        );
      },
    );
  };
}
