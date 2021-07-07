import { getSortedMin } from './Iterables';

describe('getSortedMin', () => {
  it.each`
    array              | result
    ${[1, 2, 3]}       | ${1}
    ${[1, 2, 3, 0, 0]} | ${0}
    ${[3, 2, 1]}       | ${1}
    ${[3, 1, 2, 1]}    | ${1}
    ${['b', 'a']}      | ${'a'}
    ${[]}              | ${undefined}
  `('getSortedMin($array) => $result', ({ array, result }) => {
    expect(getSortedMin(array)).toEqual(result);
  });
  it('works with custom sort function', () => {
    expect(getSortedMin([2, 3, 1], (a, b) => a > b)).toEqual(3);
  });
});
