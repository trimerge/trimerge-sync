import { diff, migrate, patch } from './MergeUtils';

const A = { a: '1' };
const B = { a: '2', b: true };
const AB_PATCH = { a: ['1', '2'], b: [true] };
describe('diff', () => {
  it('diffs objects', () => {
    expect(diff(A, B)).toEqual(AB_PATCH);
  });
});
describe('patch', () => {
  it('patches immutably', () => {
    const a = { a: '1' };
    const b = patch(a, AB_PATCH);
    expect(a).toEqual(A);
    expect(b).toEqual(B);
  });
  it('patches immutably', () => {
    expect(patch(A, undefined)).toBe(A);
  });
});

describe('migrate', () => {
  it('does nothing', () => {
    const x = {};
    expect(migrate(x)).toBe(x);
  });
});
