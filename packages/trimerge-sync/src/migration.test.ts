import { MigrateDocFn } from './TrimergeClientOptions';

describe('migrate type tests', () => {
  it('migrates', () => {
    type DocV1 = { version: 1; a: number };
    type DocV2 = { version: 2; b: number };
    type SavedDoc = DocV1 | DocV2;
    type LatestDoc = DocV2;
    const migrate: MigrateDocFn<SavedDoc, LatestDoc, string> = (
      doc,
      metadata,
    ) => {
      switch (doc.version) {
        case 1:
          return { doc: { version: 2, b: doc.a }, metadata: 'migrate' };
        case 2:
          // Up to date
          return { doc, metadata };
      }
    };
    const v1Doc: DocV1 = { version: 1, a: 12 };
    const v2Doc: DocV2 = { version: 2, b: 12 };
    expect(migrate(v1Doc, 'v1')).toEqual({
      doc: v2Doc,
      metadata: 'migrate',
    });
    expect(migrate(v2Doc, 'v2').doc).toBe(v2Doc);

    // @ts-expect-error invalid initial doc type
    expect(migrate({})).toBeUndefined();
  });

  it('valid type', () => {
    type SavedDoc = { version: number };
    type LatestDoc = { version: 2 };

    const migrate: MigrateDocFn<SavedDoc, LatestDoc, any> = () => {
      return { doc: { version: 2 }, metadata: 'blah' };
    };
    migrate({ version: 1 }, 'v1');
  });

  it('invalid type', () => {
    type DocV1 = { version: 1 };
    type DocV2 = { version: 2 };
    type SavedDoc = DocV1;
    type LatestDoc = DocV2;

    // @ts-expect-error State needs to be assignable to SavedDoc
    const migrate: MigrateDocFn<SavedDoc, LatestDoc, any> = () => {
      return { doc: { version: 2 }, metadata: 'blah' };
    };
    migrate({ version: 1 }, 'v1');
  });
});
