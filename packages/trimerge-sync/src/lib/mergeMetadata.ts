/**  Attempts to recursively merge two values, preferring newMetadata if there's ambiguity.
 *   This does not merge arrays but it will combine sets and recursively merge objects and maps.
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

  // bail on arrays, just take newMetadata's value
  if (Array.isArray(existingMetadata) && Array.isArray(newMetadata)) {
    return newMetadata;
  }

  // combine sets
  if (existingMetadata instanceof Set && newMetadata instanceof Set) {
    const merged = new Set(existingMetadata);
    for (const item of newMetadata) {
      merged.add(item);
    }
    return merged;
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
