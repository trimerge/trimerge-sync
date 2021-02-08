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

export type NormalizeFn<State, EditMetadata> = (
  state: NodeStateRef<State, EditMetadata>,
) => NodeStateRef<State, EditMetadata>;

export type NodeState<State, EditMetadata> = {
  value: State;
  editMetadata: EditMetadata;
};
export type NodeStateRef<State, EditMetadata> = {
  ref: string;
} & NodeState<State, EditMetadata>;

export type MergeStateFn<State, EditMetadata> = (
  base: NodeStateRef<State, EditMetadata> | undefined,
  left: NodeStateRef<State, EditMetadata>,
  right: NodeStateRef<State, EditMetadata>,
) => NodeState<State, EditMetadata>;

export interface Differ<State, EditMetadata, Delta> {
  readonly initialState: State;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  /** Computed the difference between two States */
  readonly diff: DiffFn<State, Delta>;
  /** Apply a patch from one state to another */
  readonly patch: PatchFn<State, Delta>;

  /** Trimerge three states */
  readonly merge: MergeStateFn<State, EditMetadata>;
}
