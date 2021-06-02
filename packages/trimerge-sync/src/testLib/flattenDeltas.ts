import { patch } from 'jsondiffpatch';
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

function getDeltaType(
  delta: Delta | ArrayMoveDelta,
):
  | {
      type: 'add';
      delta: AddDelta;
      newValue: unknown;
    }
  | {
      type: 'replace';
      delta: ReplaceDelta;
      oldValue: unknown;
      newValue: unknown;
    }
  | {
      type: 'delete';
      delta: DeleteDelta;
      oldValue: unknown;
    }
  | {
      type: 'unidiff';
      delta: UnidiffDelta;
      unidiff: string;
    }
  | {
      type: 'array-move';
      delta: ArrayMoveDelta;
      destinationIndex: number;
    }
  | { type: 'array'; delta: ArrayDelta }
  | { type: 'object'; delta: ObjectDelta } {
  if (Array.isArray(delta)) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (delta.length === 0 || delta.length > 3) {
      throw new Error('Invalid array length');
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
        throw new Error('unknown');
    }
  }
  if (delta._t === 'a') {
    return { type: 'array', delta: delta as ArrayDelta };
  }
  return { type: 'object', delta: delta as ObjectDelta };
}

export function flattenDeltas(
  d1: Delta | undefined,
  d2: Delta | undefined,
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

  if (t1.type === 'add' && t2.type === 'add') {
    throw new Error(`invalid combo: ${t1.type}, ${t2.type}`);
  }
  if (t1.type === 'add' && t2.type === 'replace') {
    return addDelta(t2.newValue);
  }
  if (t1.type === 'add' && t2.type === 'delete') {
    return undefined;
  }
  if (t1.type === 'add') {
    return addDelta(patch(t1.newValue, t2.delta));
  }

  if (t1.type === 'replace' && t2.type === 'add') {
    throw new Error(`invalid combo: ${t1.type}, ${t2.type}`);
  }
  if (t1.type === 'replace' && t2.type === 'replace') {
    return replaceDelta(t1.oldValue, t2.newValue);
  }
  if (t1.type === 'replace' && t2.type === 'delete') {
    return deleteDelta(t1.oldValue);
  }
  if (t1.type === 'replace') {
    return replaceDelta(t1.oldValue, patch(t1.newValue, t2.delta));
  }

  if (t1.type === 'delete' && t2.type === 'add') {
    return replaceDelta(t1.oldValue, t2.newValue);
  }
  if (t1.type === 'delete') {
    throw new Error(`invalid combo: ${t1.type}, ${t2.type}`);
  }

  if (t1.type === 'object' && t2.type === 'object') {
    const obj: ObjectDelta = { ...t1.delta };
    for (const key of Object.keys(t2.delta)) {
      const result = flattenDeltas(obj[key], t2.delta[key], verifyEquality);
      if (result === undefined) {
        delete obj[key];
      } else {
        obj[key] = result;
      }
    }
    return obj;
  }

  if (t1.type === 'array' && t2.type === 'array') {
    const obj: ArrayDelta = { ...t1.delta };
    for (const key of Object.keys(t2.delta)) {
      if (key === '_t') {
        continue;
      }
      // number: refers to the index in the final (right) state of the array, this is used to indicate items inserted.
      // underscore + number: refers to the index in the original (left) state of the array, this is used to indicate items removed, or moved.
      throw new Error('unsupported');
    }
    return obj;
  }

  throw new Error(`unimplemented combo: ${t1.type}, ${t2.type}`);
}
