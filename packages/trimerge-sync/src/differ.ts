import { ValueState } from './trimerge-client';

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

export type NormalizeFn<State> = (state: any) => State;

export type MergeStateFn<State, EditMetadata> = (
  base: ValueState<State, EditMetadata> | undefined,
  left: ValueState<State, EditMetadata>,
  right: ValueState<State, EditMetadata>,
) => ValueState<State, EditMetadata>;

export interface Differ<State, EditMetadata, Delta> {
  /** Converts deserialized (or undefined) state into State type */
  readonly normalize: NormalizeFn<State>;

  /** Calculate the ref string for a given edit */
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  /** Computed the difference between two States */
  readonly diff: DiffFn<State, Delta>;
  /** Apply a patch from one state to another */
  readonly patch: PatchFn<State, Delta>;
  /** Reverse apply the patch */
  readonly reversePatch?: PatchFn<State, Delta>;

  /** Trimerge three states */
  readonly merge: MergeStateFn<State, EditMetadata>;
}
