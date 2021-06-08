import { CannotMerge } from 'trimerge';

export function trimergeNumber(
  orig?: any,
  left?: any,
  right?: any,
): number | typeof CannotMerge {
  if (
    typeof orig !== 'number' &&
    typeof left !== 'number' &&
    typeof right !== 'number'
  ) {
    return CannotMerge;
  }
  return left ?? right ?? orig;
}
