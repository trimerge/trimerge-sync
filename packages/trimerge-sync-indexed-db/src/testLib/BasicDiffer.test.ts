import { merge, patch } from './BasicDiffer';

describe('patch', () => {
  it('patches undefined', () => {
    expect(patch('', undefined)).toEqual('');
  });
  it('patches string', () => {
    expect(patch('', ['', 'new'])).toEqual('new');
  });
});

describe('merge', () => {
  it('merges with undefined base', () => {
    expect(
      merge(
        undefined,
        { ref: '1', state: 'hi', editMetadata: '' },
        { ref: '2', state: 'there', editMetadata: '' },
      ),
    ).toMatchInlineSnapshot(`
      Object {
        "editMetadata": Object {
          "message": "merge",
          "ref": "(1+2)",
        },
        "state": "hithere",
      }
    `);
  });
  it('merges with base', () => {
    expect(
      merge(
        { ref: '1', state: 'hi', editMetadata: '' },
        { ref: '2', state: 'hi there', editMetadata: '' },
        { ref: '3', state: 'hello', editMetadata: '' },
      ),
    ).toMatchInlineSnapshot(`
      Object {
        "editMetadata": Object {
          "message": "merge",
          "ref": "(2+3)",
        },
        "state": "h thereello",
      }
    `);
  });
});
