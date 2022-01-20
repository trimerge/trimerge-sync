import { AutoMergeFn, CommitDoc, DocAndMetadata } from './differ';
import { mergeHeads, SortRefsFn } from './merge-heads';

export type MergeResult<LatestDoc, EditMetadata> = {
  temp?: boolean;
} & DocAndMetadata<LatestDoc, EditMetadata>;

export type MergeDocFn<LatestDoc, EditMetadata> = (
  base: CommitDoc<LatestDoc, EditMetadata> | undefined,
  left: CommitDoc<LatestDoc, EditMetadata>,
  right: CommitDoc<LatestDoc, EditMetadata>,
) => MergeResult<LatestDoc, EditMetadata>;

export function makeHeadMerger<LatestDoc, EditMetadata>(
  sortRefs: SortRefsFn,
  merge: MergeDocFn<LatestDoc, EditMetadata>,
): AutoMergeFn<LatestDoc, EditMetadata> {
  return (headRefs, getCommitInfo, getMigratedDoc, addMerge) => {
    mergeHeads(
      headRefs,
      sortRefs,
      getCommitInfo,
      (baseRef, leftRef, rightRef) => {
        const migratedBase =
          baseRef !== undefined ? getMigratedDoc(baseRef) : undefined;
        const migratedLeft = getMigratedDoc(leftRef);
        const migratedRight = getMigratedDoc(rightRef);

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
