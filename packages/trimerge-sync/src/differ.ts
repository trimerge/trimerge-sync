export type ComputeRefFn<Delta, EditMetadata> = (
  baseRef: string | undefined,
  mergeRef: string | undefined,
  delta: Delta | undefined,
  editMetadata: EditMetadata,
) => string;

export type DiffFn<SavedState, Delta> = (
  prior: SavedState | undefined,
  state: SavedState,
) => Delta | undefined;

export type PatchFn<SavedState, Delta> = (
  priorOrNext: SavedState | undefined,
  delta: Delta | undefined,
) => SavedState;

export type StateAndMetadata<State, EditMetadata> = {
  state: State;
  editMetadata: EditMetadata;
};
export type CommitState<State, EditMetadata> = {
  ref: string;
} & StateAndMetadata<State, EditMetadata>;

export type MergeResult<State, EditMetadata> = {
  lazy?: boolean;
} & StateAndMetadata<State, EditMetadata>;

export type MergeStateFn<State, EditMetadata> = (
  base: CommitState<State, EditMetadata> | undefined,
  left: CommitState<State, EditMetadata>,
  right: CommitState<State, EditMetadata>,
) => MergeResult<State, EditMetadata>;

export type MigrateStateFn<
  SavedState,
  State extends SavedState,
  EditMetadata,
> = (
  state: CommitState<SavedState, EditMetadata>,
) => CommitState<State, EditMetadata> | StateAndMetadata<State, EditMetadata>;

export interface Differ<
  SavedState,
  State extends SavedState,
  EditMetadata,
  Delta,
> {
  readonly migrate: MigrateStateFn<SavedState, State, EditMetadata>;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  /** Computed the difference between two States */
  readonly diff: DiffFn<SavedState, Delta>;
  /** Apply a patch from one state to another */
  readonly patch: PatchFn<SavedState, Delta>;

  /** Trimerge three states */
  readonly merge: MergeStateFn<State, EditMetadata>;
}
