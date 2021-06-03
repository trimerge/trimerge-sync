import {
  addDelta,
  deleteDelta,
  Delta,
  flattenDeltas,
  replaceDelta,
  unidiffDelta,
} from './flattenDeltas';
import fastDeepEqual from 'fast-deep-equal';
import { create, patch } from 'jsondiffpatch';

function crashOnNotEqual(a: unknown, b: unknown) {
  if (!fastDeepEqual(a, b)) {
    throw new Error('unexpected data mismatch');
  }
}

const jdp = create({ textDiff: { minLength: 10 } });

describe('merges deltas', () => {
  const tests: [Delta | undefined, Delta | undefined, Delta | undefined][] = [
    [
      replaceDelta('hello', 'world'),
      replaceDelta('world', 'there'),
      replaceDelta('hello', 'there'),
    ],
    [replaceDelta('hello', 'world'), undefined, replaceDelta('hello', 'world')],
    [undefined, replaceDelta('hello', 'world'), replaceDelta('hello', 'world')],
    [deleteDelta('hello'), addDelta('hello'), undefined],
    [addDelta('hello'), deleteDelta('hello'), undefined],
    [addDelta('hello'), replaceDelta('hello', 'there'), addDelta('there')],
    [
      addDelta('hello that is a darkness'),
      jdp.diff('hello that is a darkness', 'hello what is a darkness'),
      addDelta('hello what is a darkness'),
    ],
    [
      replaceDelta('hello', 'there'),
      deleteDelta('there'),
      deleteDelta('hello'),
    ],
  ];

  it.each(tests)('flattenDeltas(%s, %s) => %s', (a, b, r) => {
    expect(flattenDeltas(a, b, jdp, crashOnNotEqual)).toEqual(r);
  });
  const badTests: [Delta, Delta, string][] = [
    [
      replaceDelta('hello', 'world'),
      replaceDelta('there', 'world'),
      'unexpected data mismatch',
    ],
    [([] as unknown) as Delta, [0, 0, 0], 'invalid delta'],
    [([9, 9, 9] as unknown) as Delta, [0, 0, 0], 'invalid delta'],
    [addDelta('hello'), addDelta('world'), 'invalid combo'],
    [deleteDelta('hello'), deleteDelta('hello'), 'invalid combo'],
    [deleteDelta('hello'), replaceDelta('hello', 'world'), 'invalid combo'],
    [replaceDelta('hello', 'world'), addDelta('hello'), 'invalid combo'],
    [unidiffDelta('hello'), addDelta('hello'), 'invalid combo'],
    [unidiffDelta('hello'), {}, 'invalid combo'],
    [unidiffDelta('hello'), { _t: 'a' }, 'invalid combo'],
  ];

  it.each(badTests)('flattenDeltas(%s, %s) fails with %s', (a, b, r) => {
    expect(() => flattenDeltas(a, b, jdp, crashOnNotEqual)).toThrowError(r);
  });
  it('flattenDeltas works without 4th param', () => {
    expect(
      flattenDeltas(
        replaceDelta('hello', 'world'),
        replaceDelta('there', 'world'),
        jdp,
      ),
    ).toEqual(replaceDelta('hello', 'world'));
  });

  it('catches mispatched deltas', () => {
    expect(() =>
      flattenDeltas(
        replaceDelta('a', 'b'),
        replaceDelta('c', 'a'),
        jdp,
        crashOnNotEqual,
      ),
    ).toThrowError('unexpected data mismatch');
  });

  function testDiffPatch(a: unknown, b: unknown, c: unknown) {
    const diffAB = jdp.diff(a, b);
    const diffBC = jdp.diff(b, c);
    const flattened = flattenDeltas(diffAB, diffBC, jdp, crashOnNotEqual);

    try {
      expect(flattened ? patch(a, flattened) : a).toEqual(c);
    } catch (e) {
      console.warn(diffAB, diffBC, flattened);
      throw e;
    }
  }

  it.each([
    ['hello', 'darkness', 'my old friend'],
    [{ a: true }, { a: true, b: 'hello' }, { a: false, b: 'hello' }],
    [{ a: true }, { a: true, b: 'hello' }, { a: false, b: 'hello' }],
    [
      [1, 2, 3, 4],
      [1, 2, 3, 4, 5],
      [1, 3, 4, 5],
    ],
    [[{ id: 1 }], [{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]],
    ['hello', 'hello darkness', 'hello that is a darkness'],
    ['hello that is a darkness', 'hello', 'hello there'],
    ['hello that is a darkness', 'hello there', 'hello'],
  ])('testDiffPatch(%s, %s, %s)', (a, b, c) => {
    testDiffPatch(a, b, c);
  });

  const objects: unknown[] = [
    'hello',
    'hello darkness',
    'hello that is a darkness',
    { a: true },
    { a: true, b: 'hello' },
    { a: false, b: 'hello' },
    [1, 2, 3, 4],
    [1, 2, 3, 4, 5],
    [1, 3, 4, 5],
    undefined,
  ];

  const fuzzTests: [unknown, unknown, unknown][] = [];
  for (const a of objects) {
    for (const b of objects) {
      for (const c of objects) {
        if (a !== b && b !== c) {
          fuzzTests.push([a, b, c]);
        }
      }
    }
  }

  it.each(fuzzTests)('fuzzed testDiffPatch(%s, %s, %s) ', (a, b, c) => {
    testDiffPatch(a, b, c);
  });
});
