import { mergeMetadata } from './mergeMetadata';

describe('mergeMetadata', () => {
  it('merges simple objects', () => {
    const existingMetadata = { a: 1, b: 2 };
    const newMetadata = { a: 3, c: 4 };
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual({
      a: 3,
      b: 2,
      c: 4,
    });
  });

  it('should return newMetadata if existingMetadata is undefined', () => {
    const existingMetadata = undefined;
    const newMetadata = { a: 3, c: 4 };
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual(newMetadata);
  });

  it('should return existingMetadata if newMetadata is undefined', () => {
    const existingMetadata = { a: 1, b: 2 };
    const newMetadata = undefined;
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual(
      existingMetadata,
    );
  });

  it('shouldnt merge arrays', () => {
    const existingMetadata = [1, 2];
    const newMetadata = [3, 4];
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual(newMetadata);
  });

  it('recurses correctly', () => {
    const existingMetadata = { a: 1, b: { c: 2 } };
    const newMetadata = { a: 3, b: { c: 4 } };
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual({
      a: 3,
      b: { c: 4 },
    });
  });

  it('returns newMetadata if they are different types', () => {
    const existingMetadata = { a: 1, b: 2 };
    const newMetadata = [3, 4];
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual(newMetadata);
    expect(mergeMetadata([2, 1], 8)).toEqual(8);
    expect(mergeMetadata(8, [2, 1])).toEqual([2, 1]);
    expect(mergeMetadata('blah', [2, 1])).toEqual([2, 1]);
  });

  it('returns new metadata for simple types', () => {
    expect(mergeMetadata(2, 5)).toEqual(5);
    expect(mergeMetadata('blah', 'bar')).toEqual('bar');
  });

  it('merges sets', () => {
    const existingMetadata = new Set([1, 2]);
    const newMetadata = new Set([3, 4]);
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual(
      new Set([3, 4]),
    );
  });

  it('merges maps', () => {
    const existingMetadata = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const newMetadata = new Map([
      ['a', 3],
      ['c', 4],
    ]);
    expect(mergeMetadata(existingMetadata, newMetadata)).toEqual(
      new Map([
        ['a', 3],
        ['b', 2],
        ['c', 4],
      ]),
    );
  });

  it('merges a complex example', () => {
    const existingMetadata = {
      a: 1,
      b: { c: 2, d: [1, 3] },
      x: [1, 2],
      y: new Map<string, number | Set<number>>([
        ['a', 1],
        ['b', 2],
        ['c', new Set([1, 2])],
      ]),
    };
    const newMetadata = {
      a: 3,
      b: { c: 4, d: 5 },
      y: new Map<string, number | Set<number>>([
        ['a', 1],
        ['c', new Set([2, 3])],
      ]),
    };
    expect(mergeMetadata(existingMetadata, newMetadata)).toMatchInlineSnapshot(`
      {
        "a": 3,
        "b": {
          "c": 4,
          "d": 5,
        },
        "x": [
          1,
          2,
        ],
        "y": Map {
          "a" => 1,
          "b" => 2,
          "c" => Set {
            2,
            3,
          },
        },
      }
    `);
  });
});
