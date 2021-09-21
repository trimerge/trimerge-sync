export type ComputeRefFn<Delta, EditMetadata> = (
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: Delta | undefined,
  editMetadata: EditMetadata,
) => string;

export type DiffFn<State, Delta> = (
  prior: State | undefined,
  state: State,
) => Delta | undefined;

export type PatchFn<State, Delta> = (
  priorOrNext: State | undefined,
  delta: Delta | undefined,
) => State;

export type CommitState<State, EditMetadata> = {
  value: State;
  editMetadata: EditMetadata;
};
export type CommitStateRef<State, EditMetadata> = {
  ref: string;
} & CommitState<State, EditMetadata>;

export type MergeStateFn<State, EditMetadata> = (
  base: CommitStateRef<State, EditMetadata> | undefined,
  left: CommitStateRef<State, EditMetadata>,
  right: CommitStateRef<State, EditMetadata>,
) => CommitState<State, EditMetadata>;

export interface Differ<State, EditMetadata, Delta> {
  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  /** Computed the difference between two States */
  readonly diff: DiffFn<State, Delta>;
  /** Apply a patch from one state to another */
  readonly patch: PatchFn<State, Delta>;

  /** Trimerge three states */
  readonly merge: MergeStateFn<State, EditMetadata>;
}
