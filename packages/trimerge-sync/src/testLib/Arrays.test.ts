import { removeItem } from './Arrays';

describe('removeItem', () => {
  it('removes an item in front of array', () => {
    const array = [1, 2, 3, 4, 5];
    expect(removeItem(array, 1)).toBe(true);
    expect(array).toEqual([2, 3, 4, 5]);
  });
  it('removes an item in middle of array', () => {
    const array = [1, 2, 3];
    expect(removeItem(array, 2)).toBe(true);
    expect(array).toEqual([1, 3]);
  });
  it('does not remove missing item in array', () => {
    const array = [1, 2, 3];
    expect(removeItem(array, 4)).toBe(false);
    expect(array).toEqual([1, 2, 3]);
  });
  it('does not remove item from empty array', () => {
    const array: any[] = [];
    expect(removeItem(array, 4)).toBe(false);
    expect(array).toEqual([]);
  });
});
