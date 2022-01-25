import { CommitInfo } from './types';

export type ComputeRefFn<Delta> = (
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: Delta | undefined,
) => string;

export type DiffFn<SavedDoc, Delta> = (
  prior: SavedDoc | undefined,
  doc: SavedDoc,
) => Delta | undefined;

export type PatchFn<SavedDoc, Delta> = (
  priorOrNext: SavedDoc | undefined,
  delta: Delta | undefined,
) => SavedDoc;

export type DocAndMetadata<Doc, EditMetadata> = {
  doc: Doc;
  metadata: EditMetadata;
};
export type CommitDoc<Doc, EditMetadata> = {
  ref: string;
} & DocAndMetadata<Doc, EditMetadata>;

export type MigrateDocFn<SavedDoc, LatestDoc extends SavedDoc, EditMetadata> = (
  doc: SavedDoc,
  metadata: EditMetadata,
) => DocAndMetadata<LatestDoc, EditMetadata>;

export type MergeHelpers<LatestDoc, EditMetadata> = {
  getCommitInfo(ref: string): CommitInfo;
  computeLatestDoc(ref: string): CommitDoc<LatestDoc, EditMetadata>;
  addMerge(
    doc: LatestDoc,
    metadata: EditMetadata,
    temp: boolean,
    leftRef: string,
    rightRef: string,
  ): string;
};
export type MergeAllBranchesFn<LatestDoc, EditMetadata> = (
  branchHeadRefs: string[],
  helpers: MergeHelpers<LatestDoc, EditMetadata>,
) => void;

export interface Differ<
  SavedDoc,
  LatestDoc extends SavedDoc,
  EditMetadata,
  Delta,
> {
  readonly migrate: MigrateDocFn<SavedDoc, LatestDoc, EditMetadata>;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta>;

  /** Computed the difference between two Docs */
  readonly diff: DiffFn<SavedDoc, Delta>;

  /** Apply a patch from one Doc to another */
  readonly patch: PatchFn<SavedDoc, Delta>;

  /** Merge all head commits */
  readonly mergeAllBranches: MergeAllBranchesFn<LatestDoc, EditMetadata>;
}
