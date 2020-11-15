import { MergeStateFn } from './trimerge-client';

export type ComputeRefFn<Delta, EditMetadata> = (
  baseRef: string | undefined,
  baseRef2: string | undefined,
  delta: Delta,
  editMetadata: EditMetadata,
) => string;

export type DiffFn<State, Delta> = (
  prior: State | undefined,
  state: State,
) => Delta;

export type PatchFn<State, Delta> = (
  priorOrNext: State | undefined,
  delta: Delta,
) => State;

export interface Differ<State, EditMetadata, Delta> {
  readonly computeRef: ComputeRefFn<Delta, EditMetadata>;

  readonly diff: DiffFn<State, Delta>;
  readonly patch: PatchFn<State, Delta>;
  readonly reversePatch?: PatchFn<State, Delta>;

  readonly merge: MergeStateFn<State, EditMetadata>;
}
