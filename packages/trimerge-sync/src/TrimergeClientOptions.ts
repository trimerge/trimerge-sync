import { CommitInfo, LocalStore } from './types';

export type DocAndMetadata<Doc, CommitMetadata> = {
  doc: Doc;
  metadata: CommitMetadata;
};
export type CommitDoc<Doc, CommitMetadata> = {
  ref: string;
} & DocAndMetadata<Doc, CommitMetadata>;

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

export type AddNewCommitMetadataFn<CommitMetadata> = (
  metadata: CommitMetadata,
  commitRef: string,
  userId: string,
  clientId: string,
) => CommitMetadata;

export interface DocCache<SavedDoc, CommitMetadata> {
  get: (ref: string) => CommitDoc<SavedDoc, CommitMetadata> | undefined;
  set: (ref: string, doc: CommitDoc<SavedDoc, CommitMetadata>) => void;
  has: (ref: string) => boolean;
  delete: (ref: string) => void;
}

export type MergeHelpers<LatestDoc, CommitMetadata> = {
  getCommitInfo(ref: string): CommitInfo;
  computeLatestDoc(ref: string): CommitDoc<LatestDoc, CommitMetadata>;
  addMerge(
    doc: LatestDoc,
    metadata: CommitMetadata,
    temp: boolean,
    leftRef: string,
    rightRef: string,
  ): string;
};
export type MergeAllBranchesFn<LatestDoc, CommitMetadata> = (
  branchHeadRefs: string[],
  helpers: MergeHelpers<LatestDoc, CommitMetadata>,
) => void;

export type MigrateDocFn<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
> = (
  doc: SavedDoc,
  metadata: CommitMetadata,
) => DocAndMetadata<LatestDoc, CommitMetadata>;

export interface Differ<SavedDoc, Delta> {
  /** Computed the difference between two Docs */
  readonly diff: DiffFn<SavedDoc, Delta>;

  /** Apply a patch from one Doc to another */
  readonly patch: PatchFn<SavedDoc, Delta>;
}

export type TrimergeClientOptions<
  SavedDoc,
  LatestDoc extends SavedDoc,
  CommitMetadata,
  Delta,
  Presence,
> = {
  readonly differ: Differ<SavedDoc, Delta>;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta>;

  /** Merge all head commits */
  readonly mergeAllBranches: MergeAllBranchesFn<LatestDoc, CommitMetadata>;

  /** The local commit store. */
  readonly localStore: LocalStore<CommitMetadata, Delta, Presence>;

  /** How to convert a historical format of your document to the latest version of the document.
   *  If not supplied, the document will always be treated as if it is in the latest format.
   */
  readonly migrate?: MigrateDocFn<SavedDoc, LatestDoc, CommitMetadata>;

  readonly addNewCommitMetadata?: AddNewCommitMetadataFn<CommitMetadata>;

  /** Any user-land cleanup that should be performed when TrimergeClient shuts down. */
  readonly shutdown?: () => void | Promise<unknown>;

  /** This is an optional entry point to an alternative storage system for documents. This allows
   *  consumers of TrimergeClient to create snapshots of the document and cut off the recursive
   *  building up of the Document.
   */
  readonly docCache?: DocCache<SavedDoc, CommitMetadata>;
};
