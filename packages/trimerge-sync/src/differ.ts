export type ComputeRefFn<Delta, EditMetadata> = (
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: Delta | undefined,
  editMetadata: EditMetadata,
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
  editMetadata: EditMetadata;
};
export type CommitDoc<Doc, EditMetadata> = {
  ref: string;
} & DocAndMetadata<Doc, EditMetadata>;

export type MergeResult<LatestDoc, EditMetadata> = {
  lazy?: boolean;
} & DocAndMetadata<LatestDoc, EditMetadata>;

export type MergeDocFn<LatestDoc, EditMetadata> = (
  base: CommitDoc<LatestDoc, EditMetadata> | undefined,
  left: CommitDoc<LatestDoc, EditMetadata>,
  right: CommitDoc<LatestDoc, EditMetadata>,
) => MergeResult<LatestDoc, EditMetadata>;

export type MigrateDocFn<SavedDoc, LatestDoc extends SavedDoc, EditMetadata> = (
  doc: SavedDoc,
  editMetadata: EditMetadata,
) => DocAndMetadata<LatestDoc, EditMetadata>;

export interface Differ<
  SavedDoc,
  LatestDoc extends SavedDoc,
  EditMetadata,
  Delta,
> {
  readonly migrate: MigrateDocFn<SavedDoc, LatestDoc, EditMetadata>;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  /** Computed the difference between two Docs */
  readonly diff: DiffFn<SavedDoc, Delta>;
  /** Apply a patch from one Doc to another */
  readonly patch: PatchFn<SavedDoc, Delta>;

  /** Three-way-merge function */
  readonly merge: MergeDocFn<LatestDoc, EditMetadata>;
}
