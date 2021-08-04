import { validateNodeReferences } from './validate';
import { DiffNode } from 'trimerge-sync';

function simpleNode(
  args: Pick<
    DiffNode<unknown, unknown>,
    'ref' | 'baseRef' | 'mergeRef' | 'mergeBaseRef'
  >,
): DiffNode<unknown, unknown> {
  return {
    ...args,
    userId: 'x',
    clientId: 'x',
    editMetadata: undefined,
  };
}

describe('validateNodeReferences', () => {
  it('validates no nodes', () => {
    expect(validateNodeReferences([])).toMatchInlineSnapshot(`
      Object {
        "newNodes": Set {},
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates single root node', () => {
    expect(validateNodeReferences([simpleNode({ ref: '1' })]))
      .toMatchInlineSnapshot(`
      Object {
        "newNodes": Set {
          "1",
        },
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates simple chain', () => {
    expect(
      validateNodeReferences([
        simpleNode({ ref: '1' }),
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '3', baseRef: '2' }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "newNodes": Set {
          "1",
          "2",
          "3",
        },
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates partial chain', () => {
    expect(
      validateNodeReferences([
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '3', baseRef: '2' }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "newNodes": Set {
          "2",
          "3",
        },
        "referencedNodes": Set {
          "1",
        },
      }
    `);
  });

  it('validates merge chain', () => {
    expect(
      validateNodeReferences([
        simpleNode({ ref: '1' }),
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '3', baseRef: '1' }),
        simpleNode({
          ref: '4',
          baseRef: '2',
          mergeRef: '3',
          mergeBaseRef: '1',
        }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "newNodes": Set {
          "1",
          "2",
          "3",
          "4",
        },
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates partial merge chain', () => {
    expect(
      validateNodeReferences([
        simpleNode({ ref: '3', baseRef: '1' }),
        simpleNode({
          ref: '4',
          baseRef: '2',
          mergeRef: '3',
          mergeBaseRef: '1',
        }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "newNodes": Set {
          "3",
          "4",
        },
        "referencedNodes": Set {
          "1",
          "2",
        },
      }
    `);
  });

  it('throws for backwards simple chain', () => {
    expect(() =>
      validateNodeReferences([
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '1' }),
      ]),
    ).toThrowErrorMatchingInlineSnapshot(`"nodes out of order"`);
  });

  it('throws for backwards simple chain 2', () => {
    expect(() =>
      validateNodeReferences([
        simpleNode({ ref: '1' }),
        simpleNode({ ref: '3', baseRef: '2' }),
        simpleNode({ ref: '2', baseRef: '1' }),
      ]),
    ).toThrowErrorMatchingInlineSnapshot(`"nodes out of order"`);
  });
});
