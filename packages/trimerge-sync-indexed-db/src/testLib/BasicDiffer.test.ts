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
        { ref: '1', value: 'hi', editMetadata: '' },
        { ref: '2', value: 'there', editMetadata: '' },
      ),
    ).toMatchInlineSnapshot(`
      Object {
        "editMetadata": Object {
          "message": "merge",
          "ref": "(1+2)",
        },
        "value": "hithere",
      }
    `);
  });
  it('merges with base', () => {
    expect(
      merge(
        { ref: '1', value: 'hi', editMetadata: '' },
        { ref: '2', value: 'hi there', editMetadata: '' },
        { ref: '3', value: 'hello', editMetadata: '' },
      ),
    ).toMatchInlineSnapshot(`
      Object {
        "editMetadata": Object {
          "message": "merge",
          "ref": "(2+3)",
        },
        "value": "h thereello",
      }
    `);
  });
});
