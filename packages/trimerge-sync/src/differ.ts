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

export type MergeResult<Doc, EditMetadata> = {
  lazy?: boolean;
} & DocAndMetadata<Doc, EditMetadata>;

export type MergeDocFn<Doc, EditMetadata> = (
  base: CommitDoc<Doc, EditMetadata> | undefined,
  left: CommitDoc<Doc, EditMetadata>,
  right: CommitDoc<Doc, EditMetadata>,
) => MergeResult<Doc, EditMetadata>;

export type MigrateDocFn<SavedDoc, Doc extends SavedDoc, EditMetadata> = (
  doc: SavedDoc,
  editMetadata: EditMetadata,
) => DocAndMetadata<Doc, EditMetadata>;

export interface Differ<SavedDoc, Doc extends SavedDoc, EditMetadata, Delta> {
  readonly migrate: MigrateDocFn<SavedDoc, Doc, EditMetadata>;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  /** Computed the difference between two Docs */
  readonly diff: DiffFn<SavedDoc, Delta>;
  /** Apply a patch from one Doc to another */
  readonly patch: PatchFn<SavedDoc, Delta>;

  /** Three-way-merge function */
  readonly merge: MergeDocFn<Doc, EditMetadata>;
}
