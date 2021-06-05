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
  [index: number]: AnyDelta;
  [index: string]: AnyDelta | 'a'; // ugh
  _t: 'a';
};
type ObjectDelta = {
  [key: string]: Delta;
};
export type Delta = ValueDelta | NestedDelta;
export type AnyDelta = ValueDelta | NestedDelta | ArrayMoveDelta;

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

function isArrayMove(delta: AnyDelta): delta is ArrayMoveDelta {
  return delta[2] === 3;
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

type ModifyDeltaType =
  | ArrayDeltaType
  | ObjectDeltaType
  | ReplaceDeltaType
  | UnidiffDeltaType;

type MoveDeltaType = {
  type: 'array-move';
  delta: ArrayMoveDelta;
  newIndex: number;
};

type DeltaType =
  | AddDeltaType
  | ReplaceDeltaType
  | DeleteDeltaType
  | UnidiffDeltaType
  | ObjectDeltaType
  | MoveDeltaType
  | ArrayDeltaType;

function getDeltaType(delta: AnyDelta): DeltaType {
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
          newIndex: delta[1],
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
      if (isArrayMove(result)) {
        throw new Error('unexpected array move in object diff');
      }
      obj[key] = result;
    }
  }
  return Object.keys(obj).length > 0 ? obj : undefined;
}

type ArrayDeleteDeltaType = DeleteDeltaType & {
  oldIndex: number;
  cancel: boolean;
};
type ArrayMoveDeltaType = MoveDeltaType & {
  oldIndex: number;
  cancel: boolean;
};
type ArrayAddDeltaType = AddDeltaType & {
  newIndex: number;
  cancel: boolean;
};
type ArrayModifyDeltaType = ModifyDeltaType & {
  newIndex: number;
  cancel: boolean;
};

function parseArrayDelta(
  delta: ArrayDelta,
): {
  toRemove: (ArrayDeleteDeltaType | ArrayMoveDeltaType)[];
  toInsert: (ArrayAddDeltaType | ArrayMoveDeltaType)[];
  toModify: ArrayModifyDeltaType[];
} {
  const toRemove: (ArrayDeleteDeltaType | ArrayMoveDeltaType)[] = [];
  const toInsert: (ArrayAddDeltaType | ArrayMoveDeltaType)[] = [];
  const toModify: ArrayModifyDeltaType[] = [];
  for (const key of Object.keys(delta)) {
    if (key !== '_t') {
      const dt = getDeltaType(delta[key] as Delta | ArrayMoveDelta);
      if (key[0] === '_') {
        const oldIndex = parseInt(key.slice(1), 10);
        switch (dt.type) {
          case 'delete':
            toRemove.push({ ...dt, oldIndex, cancel: false });
            break;
          case 'array-move':
            const move = { ...dt, oldIndex, cancel: false };
            toRemove.push(move);
            toInsert.push(move);
            break;
          default:
            throw new Error(`unexpected ${dt.type} in array[${key}]`);
        }
      } else {
        const newIndex = parseInt(key, 10);
        switch (dt.type) {
          case 'add':
            toInsert.push({ ...dt, newIndex, cancel: false });
            break;
          case 'replace':
          case 'unidiff':
          case 'object':
          case 'array':
            toModify.push({ ...dt, newIndex, cancel: false });
            break;
          default:
            throw new Error(`unexpected ${dt.type} in array[${key}]`);
        }
      }
    }
  }
  toRemove.sort((a, b) => a.oldIndex - b.oldIndex);
  toInsert.sort((a, b) => a.newIndex - b.newIndex);
  return { toRemove, toInsert, toModify };
}

function flattenArrayDeltas(
  t1: ArrayDeltaType,
  t2: ArrayDeltaType,
  jdp: DiffPatcher,
  verifyEquality: ((a: unknown, b: unknown) => void) | undefined,
): ArrayDelta | undefined {
  // number: refers to the index in the final (right) state of the array, this is used to indicate items inserted.
  // underscore + number: refers to the index in the original (left) state of the array, this is used to indicate items removed, or moved.

  // The way array diffs work in jsondiffpatch:
  // 1. the array fields are split into three lists:
  //    a. `_<num>` (delete/moves) is put into a toRemove list
  //    b. `<num>` with an add delta is put into a toInsert list
  //    c. `<num>` with a modify delta is put into a toModify list
  // 2. the toRemove list is sorted by index
  // 3. items are removed in reverse order from the array
  //    a. any move items are added to the toInsert list
  // 4. the toInsert list is sorted by index
  // 5. items are inserted into the array
  // 6. finally, the toModify list is applied to the final array

  // So in summary:
  //   1. removes and the removal part of a moves are run first
  //   2. inserts are applied second
  //   3. modifies last

  // To combine two deltas we need to simulate running this twice

  const array1 = parseArrayDelta(t1.delta);
  const array2 = parseArrayDelta(t2.delta);

  // console.log('BEFORE array1', array1, 'array2', array2);

  // if we have { 2: add(A) } + { 2: add(B) } we need: { 2: add(B), 3: add(A) }
  //   so if delta 2 has an add, increase delta1 ≥X index by 1
  // if we have { 2: modify(A) } + { 1: add(B) } we need: { 1: add(B), 3: modify(A) }
  //   so if delta 2 has an add, increase delta1 ≥X index by 1
  for (const insert2 of array2.toInsert) {
    for (const insert1 of array1.toInsert) {
      if (insert1.newIndex >= insert2.newIndex) {
        insert1.newIndex++;
      }
    }
    for (const modify1 of array1.toModify) {
      if (modify1.newIndex >= insert2.newIndex) {
        modify1.newIndex++;
      }
    }
  }

  // if we have { 1: add(A) } + { _2: remove(B) } we need: { 1: add(A), _1: remove(B) }
  //   so if delta 1 has an add, we need to decrease delta2 ≥X removes by 1
  for (const remove2 of array2.toRemove) {
    for (const insert1 of array1.toInsert) {
      // TODO: this loop can be merged down below
      if (remove2.oldIndex === insert1.newIndex) {
        // delete both insert and remove
        insert1.cancel = true;
        remove2.cancel = true;
      }
      if (remove2.oldIndex > insert1.newIndex) {
        remove2.oldIndex--;
      }
    }
  }
  // if we have { _2: remove(A) } + { _2: remove(B) } we need: { _2: remove(A), _3: remove(B) }
  //   so if delta 1 has an remove, we need to increase delta2 ≥X removes by 1
  // if we have { _0: remove(A) } + { 0: add(B) } we need: { _0: remove(A), 0: add(B) }
  //   so if delta 1 has an remove, we don't need to do anything to adds
  for (const remove1 of array1.toRemove) {
    for (const remove2 of array2.toRemove) {
      if (remove2.oldIndex >= remove1.oldIndex) {
        remove2.oldIndex++;
      }
    }
  }
  // if we have { 2: modify(A) } + { _0: remove(B) } we need: { _0: remove(B), 1: modify(A) }
  //   so if delta 2 has a remove, decrease delta 1 ≤X modifies by 1
  // if we have { 2: add(A) } + { _0: remove(B) } we need: { _0: remove(B), 1: add(A) }
  //   so if delta 2 has a remove, decrease delta 1 ≤X adds by 1
  for (const remove2 of array2.toRemove) {
    for (const modify1 of array1.toModify) {
      if (remove2.oldIndex <= modify1.newIndex) {
        modify1.newIndex--;
      }
    }
    for (const insert1 of array1.toInsert) {
      if (remove2.oldIndex <= insert1.newIndex) {
        insert1.newIndex--;
      }
    }
  }

  // if we have { 1: add(A) } + { _1: remove(B) } we need: {}
  //   so if delta 1 has an add and delta 2 has delete at same index, cancel them out (plus other rules below)
  // if we have { 1: modify(A,B) } + { _1: remove(B) } we need: { remove(A) }
  //   so if delta 1 has an modify and delta 2 has delete at same index, delete wins (plus other rules below)
  // if we have { 1: add(A) } + { 1: modify(B) } we need: { 1: add(B) }
  //   so if delta 1 has an add and delta 2 has modify at same index, combine
  // if we have { 1: modify(A) } + { 1: modify(B) } we need: { 1: add(B) }
  //   so if delta 1 has an modify and delta 2 has modify at same index, combine

  const obj: ArrayDelta = { _t: 'a' };

  for (const insert1 of array1.toInsert) {
    if (insert1.type !== 'array-move' && !insert1.cancel) {
      obj[insert1.newIndex] = insert1.delta;
    }
  }
  for (const modify1 of array1.toModify) {
    if (!modify1.cancel) {
      obj[modify1.newIndex] = modify1.delta;
    }
  }
  for (const remove1 of array1.toRemove) {
    if (!remove1.cancel) {
      obj['_' + remove1.oldIndex] =
        remove1.type === 'array-move'
          ? arrayMove(remove1.newIndex)
          : remove1.delta;
    }
  }

  for (const insert2 of array2.toInsert) {
    if (insert2.type !== 'array-move' && !insert2.cancel) {
      if (obj[insert2.newIndex]) {
        throw new Error('double add');
      }
      obj[insert2.newIndex] = insert2.delta;
    }
  }
  for (const modify2 of array2.toModify) {
    if (!modify2.cancel) {
      const result = flattenDeltas(
        obj[modify2.newIndex],
        modify2.delta,
        jdp,
        verifyEquality,
      );
      if (result) {
        obj[modify2.newIndex] = result;
      } else {
        delete obj[modify2.newIndex];
      }
    }
  }
  for (const remove2 of array2.toRemove) {
    if (!remove2.cancel) {
      const key = '_' + remove2.oldIndex;
      const result = flattenDeltas(
        obj[key] as AnyDelta,
        remove2.type === 'array-move'
          ? arrayMove(remove2.newIndex)
          : remove2.delta,
        jdp,
        verifyEquality,
      );
      if (result) {
        obj[key] = result;
      } else {
        delete obj[key];
      }
    }
  }

  // const obj: ArrayDelta = { ...t1.delta };
  // for (const key of Object.keys(t2.delta)) {
  //   if (key === '_t') {
  //     continue;
  //   }
  //   const indexInOrigin = key[0] === '_';
  //   const index = parseInt(indexInOrigin ? key.slice(1) : key, 10);
  //   if (indexInOrigin) {
  //     const ct1 = getDeltaType(obj[index]);
  //     const ct2 = getDeltaType(t2.delta[index]);
  //     const result = flattenDeltaTypes(ct1, ct2, jdp, verifyEquality);
  //     if (result !== undefined) {
  //       obj[index] = result;
  //     } else {
  //       delete obj[index];
  //     }
  //   } else {
  //     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  //     // @ts-ignore
  //     obj[key] = flattenDeltas(obj[key], t2.delta[key], jdp, verifyEquality);
  //   }
  // }
  if (Object.keys(obj).length === 1) {
    console.log('result', undefined);
    return undefined;
  }
  console.log('result', obj);
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
  d1: AnyDelta | undefined,
  d2: AnyDelta | undefined,
  jdp: DiffPatcher,
  verifyEquality?: (a: unknown, b: unknown) => void,
): AnyDelta | undefined {
  if (!d1) {
    return d2;
  }
  if (!d2) {
    return d1;
  }
  return flattenDeltaTypes(
    getDeltaType(d1),
    getDeltaType(d2),
    jdp,
    verifyEquality,
  );
}
function flattenDeltaTypes(
  t1: DeltaType,
  t2: DeltaType,
  jdp: DiffPatcher,
  verifyEquality?: (a: unknown, b: unknown) => void,
): Delta | undefined {
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
