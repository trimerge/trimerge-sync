export function getSortedMin<T>(
  array: Iterable<T>,
  isLessThan: (a: T, b: T) => boolean = (a, b) => a < b,
): T | undefined {
  let result = undefined;
  for (const item of array) {
    if (result === undefined || isLessThan(item, result)) {
      result = item;
    }
  }
  return result;
}
