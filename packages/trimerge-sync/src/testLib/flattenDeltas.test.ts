import { Delta, flattenDeltas, replaceDelta } from './flattenDeltas';
import fastDeepEqual from 'fast-deep-equal';
import { create, diff, patch } from 'jsondiffpatch';

function crashOnNotEqual(a: unknown, b: unknown) {
  if (!fastDeepEqual(a, b)) {
    throw new Error('unexpected data mismatch');
  }
}

const jdp = create({ textDiff: { minLength: 10 } });

describe('merges deltas', () => {
  const tests: [Delta, Delta, Delta][] = [
    [
      replaceDelta('hello', 'world'),
      replaceDelta('world', 'there'),
      replaceDelta('hello', 'there'),
    ],
  ];

  it.each(tests)('flattenDeltas(%s, %s) => %s', (a, b, r) => {
    expect(flattenDeltas(a, b)).toEqual(r);
  });

  it('catches mispatched deltas', () => {
    expect(() =>
      flattenDeltas(
        replaceDelta('a', 'b'),
        replaceDelta('c', 'a'),
        crashOnNotEqual,
      ),
    ).toThrowError('unexpected data mismatch');
  });

  function testDiffPatch(a: unknown, b: unknown, c: unknown) {
    const diffAB = jdp.diff(a, b);
    const diffBC = jdp.diff(b, c);
    console.log(diffAB, diffBC);
    const flattened = flattenDeltas(diffAB, diffBC, crashOnNotEqual);
    console.log(flattened);
    expect(flattened ? patch(a, flattened) : a).toEqual(c);
  }

  it.each([
    ['hello', 'darkness', 'my old friend'],
    [{ a: true }, { a: true, b: 'hello' }, { a: false, b: 'hello' }],
    [
      [1, 2, 3, 4],
      [1, 2, 3, 4, 5],
      [1, 3, 4, 5],
    ],
    ['hello', 'hello darkness', 'hello that is a darkness'],
  ])('testDiffPatch(%s, %s, %s)', (a, b, c) => {
    testDiffPatch(a, b, c);
  });
});
