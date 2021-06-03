import type { DiffPatcher } from 'jsondiffpatch';
import { flattenUnidiffs } from './flattenUnidiffs';

type AddDelta = [unknown];
type ReplaceDelta = [unknown, unknown];
type DeleteDelta = [unknown, 0, 0];
type UnidiffDelta = [string, 0, 2];

type ArrayMoveDelta = ['', number, 3];

type ValueDelta = AddDelta | ReplaceDelta | DeleteDelta | UnidiffDelta;
type NestedDelta = ArrayDelta | ObjectDelta;

type ArrayDelta = {
  _t: 'a';
  [index: number]: Delta | ArrayMoveDelta;
  [index: string]: Delta | ArrayMoveDelta | 'a'; // ugh
};
type ObjectDelta = {
  [key: string]: Delta;
};
export type Delta = ValueDelta | NestedDelta;

export function addDelta(newValue: unknown): AddDelta {
  return [newValue];
}
export function replaceDelta(
  oldValue: unknown,
  newValue: unknown,
): ReplaceDelta {
  return [oldValue, newValue];
}
export function deleteDelta(oldValue: unknown): DeleteDelta {
  return [oldValue, 0, 0];
}
export function unidiffDelta(unidiff: string): UnidiffDelta {
  return [unidiff, 0, 2];
}
export function arrayMove(destinationIndex: number): ArrayMoveDelta {
  return ['', destinationIndex, 3];
}

type AddDeltaType = {
  type: 'add';
  delta: AddDelta;
  newValue: unknown;
};
type ReplaceDeltaType = {
  type: 'replace';
  delta: ReplaceDelta;
  oldValue: unknown;
  newValue: unknown;
};
type DeleteDeltaType = {
  type: 'delete';
  delta: DeleteDelta;
  oldValue: unknown;
};
type UnidiffDeltaType = {
  type: 'unidiff';
  delta: UnidiffDelta;
  unidiff: string;
};
type ObjectDeltaType = { type: 'object'; delta: ObjectDelta };
type ArrayDeltaType = { type: 'array'; delta: ArrayDelta };
type ArrayMoveDeltaType = {
  type: 'array-move';
  delta: ArrayMoveDelta;
  destinationIndex: number;
};

type DeltaType =
  | AddDeltaType
  | ReplaceDeltaType
  | DeleteDeltaType
  | UnidiffDeltaType
  | ObjectDeltaType
  | ArrayMoveDeltaType
  | ArrayDeltaType;

function getDeltaType(delta: Delta | ArrayMoveDelta): DeltaType {
  if (Array.isArray(delta)) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (delta.length === 0 || delta.length > 3) {
      throw new Error('invalid delta');
    }
    if (delta.length === 1) {
      return {
        type: 'add',
        delta,
        newValue: delta[0],
      };
    }
    if (delta.length === 2) {
      return {
        type: 'replace',
        delta,
        oldValue: delta[0],
        newValue: delta[1],
      };
    }
    switch (delta[2]) {
      case 0:
        return {
          type: 'delete',
          delta,
          oldValue: delta[0],
        };
      case 2:
        return {
          type: 'unidiff',
          delta,
          unidiff: delta[0],
        };
      case 3:
        return {
          type: 'array-move',
          delta,
          destinationIndex: delta[1],
        };
      default:
        throw new Error('invalid delta');
    }
  }
  if (delta._t === 'a') {
    return { type: 'array', delta: delta as ArrayDelta };
  }
  return { type: 'object', delta: delta as ObjectDelta };
}

function invalidCombo(t1: DeltaType, t2: DeltaType) {
  return new Error(`invalid combo: ${t1.type}, ${t2.type}`);
}

function flattenObjectDeltas(
  t1: ObjectDeltaType,
  t2: ObjectDeltaType,
  jdp: DiffPatcher,
  verifyEquality: ((a: unknown, b: unknown) => void) | undefined,
): ObjectDelta | undefined {
  const obj: ObjectDelta = { ...t1.delta };
  for (const key of Object.keys(t2.delta)) {
    const result = flattenDeltas(obj[key], t2.delta[key], jdp, verifyEquality);
    if (result === undefined) {
      delete obj[key];
    } else {
      obj[key] = result;
    }
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

function flattenArrayDeltas(
  t1: ArrayDeltaType,
  t2: ArrayDeltaType,
  jdp: DiffPatcher,
  verifyEquality: ((a: unknown, b: unknown) => void) | undefined,
): ArrayDelta | undefined {
  const obj: ArrayDelta = { ...t1.delta };
  console.log(t1.delta, t2.delta);
  for (const key of Object.keys(t2.delta)) {
    if (key === '_t') {
      continue;
    }
    // const indexInOrigin = key[0] === '_';
    // const index = parseInt(indexInOrigin ? key.slice(1) : key, 10);
    // if (indexInOrigin) {
    //   throw new Error('unsupported');
    // } else {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    obj[key] = flattenDeltas(obj[key], t2.delta[key], jdp, verifyEquality);
    // }
    // number: refers to the index in the final (right) state of the array, this is used to indicate items inserted.
    // underscore + number: refers to the index in the original (left) state of the array, this is used to indicate items removed, or moved.
  }
  return obj;
}
function flattenAnyReplace(
  t1: DeltaType,
  t2: ReplaceDeltaType,
  jdp: DiffPatcher,
) {
  const oldValue = jdp.unpatch(jdp.clone(t2.oldValue), t1.delta);
  return jdp.diff(oldValue, t2.newValue);
}

function flattenAnyDelete(
  t1: DeltaType,
  t2: DeleteDeltaType,
  jdp: DiffPatcher,
) {
  const oldValue = jdp.unpatch(jdp.clone(t2.oldValue), t1.delta);
  return deleteDelta(oldValue);
}

export function flattenDeltas(
  d1: Delta | undefined,
  d2: Delta | undefined,
  jdp: DiffPatcher,
  verifyEquality?: (a: unknown, b: unknown) => void,
): Delta | undefined {
  if (!d1) {
    return d2;
  }
  if (!d2) {
    return d1;
  }

  const t1 = getDeltaType(d1);
  const t2 = getDeltaType(d2);

  if ('newValue' in t1 && 'oldValue' in t2) {
    verifyEquality?.(t1.newValue, t2.oldValue);
  }

  switch (t1.type) {
    case 'add':
      switch (t2.type) {
        case 'add':
        case 'array-move':
          throw invalidCombo(t1, t2);

        case 'replace':
          return addDelta(t2.newValue);

        case 'delete':
          return undefined;

        case 'unidiff':
        case 'array':
        case 'object':
          return addDelta(jdp.patch(jdp.clone(t1.newValue), t2.delta));
      }
      break;
    case 'replace':
      switch (t2.type) {
        case 'add':
          throw invalidCombo(t1, t2);

        case 'replace':
          return jdp.diff(t1.oldValue, t2.newValue);

        case 'delete':
          return deleteDelta(t1.oldValue);

        case 'unidiff':
        case 'array-move':
        case 'array':
        case 'object':
          return jdp.diff(
            t1.oldValue,
            jdp.patch(jdp.clone(t1.newValue), t2.delta),
          );
      }
      break;
    case 'delete':
      switch (t2.type) {
        case 'add':
          return jdp.diff(t1.oldValue, t2.newValue);

        case 'replace':
        case 'delete':
        case 'unidiff':
        case 'array-move':
        case 'array':
        case 'object':
          throw invalidCombo(t1, t2);
      }
      break;
    case 'unidiff':
      switch (t2.type) {
        case 'add':
        case 'array-move':
        case 'array':
        case 'object':
          throw invalidCombo(t1, t2);

        case 'replace':
          return flattenAnyReplace(t1, t2, jdp);

        case 'delete':
          return flattenAnyDelete(t1, t2, jdp);

        case 'unidiff':
          return unidiffDelta(flattenUnidiffs(t1.unidiff, t2.unidiff));
      }
      break;
    case 'array-move':
      switch (t2.type) {
        case 'add':
          break;
        case 'replace':
          break;
        case 'delete':
          break;
        case 'unidiff':
          break;
        case 'array-move':
          break;
        case 'array':
          break;
        case 'object':
          break;
      }
      break;
    case 'array':
      switch (t2.type) {
        case 'add':
        case 'unidiff':
        case 'object':
        case 'array-move':
          throw invalidCombo(t1, t2);
        case 'replace':
          return flattenAnyReplace(t1, t2, jdp);
        case 'delete':
          return flattenAnyDelete(t1, t2, jdp);
        case 'array':
          return flattenArrayDeltas(t1, t2, jdp, verifyEquality);
      }
      break;
    case 'object':
      switch (t2.type) {
        case 'add':
        case 'unidiff':
        case 'array':
        case 'array-move':
          throw invalidCombo(t1, t2);
        case 'replace':
          return flattenAnyReplace(t1, t2, jdp);
        case 'delete':
          return flattenAnyDelete(t1, t2, jdp);
        case 'object':
          return flattenObjectDeltas(t1, t2, jdp, verifyEquality);
      }
      break;
  }

  throw new Error(`unimplemented combo: ${t1.type}, ${t2.type}`);
}
