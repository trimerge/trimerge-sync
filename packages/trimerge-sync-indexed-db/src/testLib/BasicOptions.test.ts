import { merge, patch } from './BasicOptions';

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
        { ref: '1', doc: 'hi', metadata: '' },
        { ref: '2', doc: 'there', metadata: '' },
      ),
    ).toMatchInlineSnapshot(`
      {
        "doc": "hithere",
        "metadata": {
          "message": "merge",
          "ref": "(1+2)",
        },
      }
    `);
  });
  it('merges with base', () => {
    expect(
      merge(
        { ref: '1', doc: 'hi', metadata: '' },
        { ref: '2', doc: 'hi there', metadata: '' },
        { ref: '3', doc: 'hello', metadata: '' },
      ),
    ).toMatchInlineSnapshot(`
      {
        "doc": "h thereello",
        "metadata": {
          "message": "merge",
          "ref": "(2+3)",
        },
      }
    `);
  });
});
