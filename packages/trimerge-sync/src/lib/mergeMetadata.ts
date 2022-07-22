/**  Attempts to recursively merge two values, preferring newMetadata if there's ambiguity.
 *   This does not merge arrays or sets but it will recursively merge objects and maps.
 */
export function mergeMetadata(
  existingMetadata: unknown,
  newMetadata: unknown,
): unknown {
  // check for null
  if (existingMetadata === undefined || existingMetadata === null) {
    return newMetadata;
  }
  if (newMetadata === undefined || newMetadata === null) {
    return existingMetadata;
  }

  // check for mismatched types
  if (
    typeof existingMetadata !== typeof newMetadata ||
    Array.isArray(existingMetadata) !== Array.isArray(newMetadata)
  ) {
    return newMetadata;
  }

  // bail on arrays and sets, just take newMetadata's value
  if (
    (Array.isArray(existingMetadata) && Array.isArray(newMetadata)) ||
    (existingMetadata instanceof Set && newMetadata instanceof Set)
  ) {
    return newMetadata;
  }

  // recursively merge maps
  if (existingMetadata instanceof Map && newMetadata instanceof Map) {
    const merged = new Map(existingMetadata);
    for (const [key, value] of newMetadata) {
      merged.set(key, mergeMetadata(merged.get(key), value));
    }
    return merged;
  }

  // recursively merge objects
  if (
    typeof existingMetadata === 'object' &&
    typeof newMetadata === 'object' &&
    existingMetadata !== null &&
    newMetadata !== null
  ) {
    const indexableNewMetadata = newMetadata as { [key: string]: unknown };
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(existingMetadata)) {
      if (key in indexableNewMetadata) {
        result[key] = mergeMetadata(value, indexableNewMetadata[key]);
      } else {
        result[key] = value;
      }
    }
    for (const [key, value] of Object.entries(newMetadata)) {
      if (!(key in result)) {
        result[key] = value;
      }
    }
    return result;
  }

  // when in doubt, just return newMetadata
  return newMetadata;
}
