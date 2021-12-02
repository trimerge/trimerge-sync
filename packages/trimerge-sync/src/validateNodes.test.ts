import {
  addInvalidRefsToAckEvent,
  validateCommitOrder,
} from './validateCommits';
import type { AckCommitsEvent, Commit, MergeCommit } from 'trimerge-sync';
import { CommitRefs } from './lib/Commits';

function simpleCommit(
  args: CommitRefs,
): Commit<unknown, unknown> {
  return {
    ...args,
    userId: 'x',
    editMetadata: undefined,
  };
}

describe('validateCommitOrder', () => {
  it('validates no commits', () => {
    expect(validateCommitOrder([])).toMatchInlineSnapshot(`
      Object {
        "invalidRefs": Set {},
        "newCommits": Array [],
        "referencedCommits": Set {},
      }
    `);
  });

  it('validates single root commit', () => {
    expect(validateCommitOrder([simpleCommit({ ref: '1' })]))
      .toMatchInlineSnapshot(`
      Object {
        "invalidRefs": Set {},
        "newCommits": Array [
          Object {
            "clientId": "x",
            "editMetadata": undefined,
            "ref": "1",
            "userId": "x",
          },
        ],
        "referencedCommits": Set {},
      }
    `);
  });

  it('validates simple chain', () => {
    expect(
      validateCommitOrder([
        simpleCommit({ ref: '1' }),
        simpleCommit({ ref: '2', baseRef: '1' }),
        simpleCommit({ ref: '3', baseRef: '2' }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "invalidRefs": Set {},
        "newCommits": Array [
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
        "referencedCommits": Set {},
      }
    `);
  });

  it('validates partial chain', () => {
    expect(
      validateCommitOrder([
        simpleCommit({ ref: '2', baseRef: '1' }),
        simpleCommit({ ref: '3', baseRef: '2' }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "invalidRefs": Set {},
        "newCommits": Array [
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
        "referencedCommits": Set {
          "1",
        },
      }
    `);
  });

  it('validates merge chain', () => {
    expect(
      validateCommitOrder([
        simpleCommit({ ref: '1' }),
        simpleCommit({ ref: '2', baseRef: '1' }),
        simpleCommit({ ref: '3', baseRef: '1' }),
        simpleCommit({
          ref: '4',
          baseRef: '2',
          mergeRef: '3',
          mergeBaseRef: '1',
        }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "invalidRefs": Set {},
        "newCommits": Array [
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
        "referencedCommits": Set {},
      }
    `);
  });

  it('validates partial merge chain', () => {
    expect(
      validateCommitOrder([
        simpleCommit({ ref: '3', baseRef: '1' }),
        simpleCommit({
          ref: '4',
          baseRef: '2',
          mergeRef: '3',
          mergeBaseRef: '1',
        }),
      ]),
    ).toMatchInlineSnapshot(`
      Object {
        "invalidRefs": Set {},
        "newCommits": Array [
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
        "referencedCommits": Set {
          "1",
          "2",
        },
      }
    `);
  });

  it('throws for backwards simple chain', () => {
    expect(() =>
      validateCommitOrder([
        simpleCommit({ ref: '2', baseRef: '1' }),
        simpleCommit({ ref: '1' }),
      ]),
    ).toMatchInlineSnapshot(`[Function]`);
  });

  it('throws for backwards simple chain 2', () => {
    expect(() =>
      validateCommitOrder([
        simpleCommit({ ref: '1' }),
        simpleCommit({ ref: '3', baseRef: '2' }),
        simpleCommit({ ref: '2', baseRef: '1' }),
      ]),
    ).toMatchInlineSnapshot(`[Function]`);
  });
});

describe('addInvalidRefsToAckEvent', () => {
  it('adds no commits', () => {
    const ack: AckCommitsEvent = { type: 'ack', syncId: '', refs: [] };
    expect(addInvalidRefsToAckEvent(ack, new Set())).toBe(ack);
  });
  it('adds 1 commit', () => {
    const ack: AckCommitsEvent = { type: 'ack', syncId: '', refs: [] };
    expect(addInvalidRefsToAckEvent(ack, new Set(['hi'])))
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
  it('adds 2 commits', () => {
    const ack: AckCommitsEvent = {
      type: 'ack',
      syncId: '',
      refs: [],
      refErrors: { yo: { code: 'internal' } },
    };
    expect(addInvalidRefsToAckEvent(ack, new Set(['hi', 'there'])))
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
  it('does not overwrite commit', () => {
    const ack: AckCommitsEvent = {
      type: 'ack',
      syncId: '',
      refs: [],
      refErrors: { hi: { code: 'internal' } },
    };
    expect(addInvalidRefsToAckEvent(ack, new Set(['hi']))).toEqual(ack);
  });
});
