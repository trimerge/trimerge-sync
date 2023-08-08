import {
  MergeAllBranchesFn,
  CommitDoc,
  DocAndMetadata,
} from './TrimergeClientOptions';
import { mergeHeads, SortRefsFn } from './merge-heads';

export type MergeResult<LatestDoc, CommitMetadata> = {
  temp?: boolean;
} & DocAndMetadata<LatestDoc, CommitMetadata>;

export type MergeDocFn<LatestDoc, CommitMetadata> = (
  base: CommitDoc<LatestDoc, CommitMetadata> | undefined,
  left: CommitDoc<LatestDoc, CommitMetadata>,
  right: CommitDoc<LatestDoc, CommitMetadata>,
) => MergeResult<LatestDoc, CommitMetadata>;

export function makeMergeAllBranchesFn<LatestDoc, CommitMetadata>(
  sortRefs: SortRefsFn,
  merge: MergeDocFn<LatestDoc, CommitMetadata>,
): MergeAllBranchesFn<LatestDoc, CommitMetadata> {
  return (
    headRefs,
    { addMerge, getCommitInfo, getMergeRef, computeLatestDoc, reuseMerge },
  ) => {
    mergeHeads(
      headRefs,
      sortRefs,
      getCommitInfo,
      getMergeRef,
      reuseMerge,
      (baseRef, leftRef, rightRef, _, reference) => {
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
          reference,
        );
      },
    );
  };
}
