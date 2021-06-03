import {
  computeUnidiff,
  flattenUnidiffs,
  patchUnidiff,
} from './flattenUnidiffs';

describe('flattenUnidiffs', () => {
  const objects: string[] = [
    'hello',
    'hello darkness',
    'hello fondness',
    'hello that is a darkness',
    'wat',
  ];

  const fuzzTests: [string, string, string][] = [];
  for (const a of objects) {
    for (const b of objects) {
      for (const c of objects) {
        if (a !== b && b !== c) {
          fuzzTests.push([a, b, c]);
        }
      }
    }
  }

  function testDiffPatch(a: string, b: string, c: string) {
    const diffAB = computeUnidiff(a, b);
    const diffBC = computeUnidiff(b, c);
    const flattened = flattenUnidiffs(diffAB, diffBC);
    expect(patchUnidiff(a, flattened)).toEqual(c);
  }

  it.each(fuzzTests)('fuzzed testDiffPatch(%s, %s, %s) ', (a, b, c) => {
    testDiffPatch(a, b, c);
  });
});
