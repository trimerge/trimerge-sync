import {
  addInvalidNodesToAckEvent,
  validateDiffNodeOrder,
} from './validateNodes';
import type { AckNodesEvent, DiffNode } from 'trimerge-sync';

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

describe('validateDiffNodeOrder', () => {
  it('validates no nodes', () => {
    expect(validateDiffNodeOrder([])).toMatchInlineSnapshot(`
      Object {
        "invalidNodeRefs": Set {},
        "newNodes": Array [],
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates single root node', () => {
    expect(validateDiffNodeOrder([simpleNode({ ref: '1' })]))
      .toMatchInlineSnapshot(`
      Object {
        "invalidNodeRefs": Set {},
        "newNodes": Array [
          Object {
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "1",
            "userId": "x",
          },
        ],
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates simple chain', () => {
    expect(
      validateDiffNodeOrder([
        simpleNode({ ref: '1' }),
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '3', baseRef: '2' }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "invalidNodeRefs": Set {},
        "newNodes": Array [
          Object {
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "1",
            "userId": "x",
          },
          Object {
            "baseRef": "1",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "2",
            "userId": "x",
          },
          Object {
            "baseRef": "2",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "3",
            "userId": "x",
          },
        ],
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates partial chain', () => {
    expect(
      validateDiffNodeOrder([
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '3', baseRef: '2' }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "invalidNodeRefs": Set {},
        "newNodes": Array [
          Object {
            "baseRef": "1",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "2",
            "userId": "x",
          },
          Object {
            "baseRef": "2",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "3",
            "userId": "x",
          },
        ],
        "referencedNodes": Set {
          "1",
        },
      }
    `);
  });

  it('validates merge chain', () => {
    expect(
      validateDiffNodeOrder([
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
        "invalidNodeRefs": Set {},
        "newNodes": Array [
          Object {
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "1",
            "userId": "x",
          },
          Object {
            "baseRef": "1",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "2",
            "userId": "x",
          },
          Object {
            "baseRef": "1",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "3",
            "userId": "x",
          },
          Object {
            "baseRef": "2",
            "clientId": "x",
            "editMetadata": undefined,
            "mergeBaseRef": "1",
            "mergeRef": "3",
            "ref": "4",
            "userId": "x",
          },
        ],
        "referencedNodes": Set {},
      }
    `);
  });

  it('validates partial merge chain', () => {
    expect(
      validateDiffNodeOrder([
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
        "invalidNodeRefs": Set {},
        "newNodes": Array [
          Object {
            "baseRef": "1",
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "3",
            "userId": "x",
          },
          Object {
            "baseRef": "2",
            "clientId": "x",
            "editMetadata": undefined,
            "mergeBaseRef": "1",
            "mergeRef": "3",
            "ref": "4",
            "userId": "x",
          },
        ],
        "referencedNodes": Set {
          "1",
          "2",
        },
      }
    `);
  });

  it('throws for backwards simple chain', () => {
    expect(() =>
      validateDiffNodeOrder([
        simpleNode({ ref: '2', baseRef: '1' }),
        simpleNode({ ref: '1' }),
      ]),
    ).toMatchInlineSnapshot(`[Function]`);
  });

  it('throws for backwards simple chain 2', () => {
    expect(() =>
      validateDiffNodeOrder([
        simpleNode({ ref: '1' }),
        simpleNode({ ref: '3', baseRef: '2' }),
        simpleNode({ ref: '2', baseRef: '1' }),
      ]),
    ).toMatchInlineSnapshot(`[Function]`);
  });
});

describe('addInvalidNodesToAckEvent', () => {
  it('adds no nodes', () => {
    const ack: AckNodesEvent = { type: 'ack', syncId: '', refs: [] };
    expect(addInvalidNodesToAckEvent(ack, new Set())).toBe(ack);
  });
  it('adds 1 node', () => {
    const ack: AckNodesEvent = { type: 'ack', syncId: '', refs: [] };
    expect(addInvalidNodesToAckEvent(ack, new Set(['hi'])))
      .toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {
          "hi": Object {
            "code": "unknown-ref",
          },
        },
        "refs": Array [],
        "syncId": "",
        "type": "ack",
      }
    `);
  });
  it('adds 2 nodes', () => {
    const ack: AckNodesEvent = {
      type: 'ack',
      syncId: '',
      refs: [],
      refErrors: { yo: { code: 'internal' } },
    };
    expect(addInvalidNodesToAckEvent(ack, new Set(['hi', 'there'])))
      .toMatchInlineSnapshot(`
      Object {
        "refErrors": Object {
          "hi": Object {
            "code": "unknown-ref",
          },
          "there": Object {
            "code": "unknown-ref",
          },
          "yo": Object {
            "code": "internal",
          },
        },
        "refs": Array [],
        "syncId": "",
        "type": "ack",
      }
    `);
  });
  it('does not overwrite node', () => {
    const ack: AckNodesEvent = {
      type: 'ack',
      syncId: '',
      refs: [],
      refErrors: { hi: { code: 'internal' } },
    };
    expect(addInvalidNodesToAckEvent(ack, new Set(['hi']))).toEqual(ack);
  });
});
