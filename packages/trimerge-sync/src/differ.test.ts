import { MigrateDocFn } from './differ';

describe('migrate type tests', () => {
  it('migrates', () => {
    type DocV1 = { version: 1; a: number };
    type DocV2 = { version: 2; b: number };
    type SavedDoc = DocV1 | DocV2;
    type Doc = DocV2;
    const migrate: MigrateDocFn<SavedDoc, Doc, string> = (
      doc,
      editMetadata,
    ) => {
      switch (doc.version) {
        case 1:
          return { doc: { version: 2, b: doc.a }, editMetadata: 'migrate' };
        case 2:
          // Up to date
          return { doc, editMetadata };
      }
    };
    const v1Doc: DocV1 = { version: 1, a: 12 };
    const v2Doc: DocV2 = { version: 2, b: 12 };
    expect(migrate(v1Doc, 'v1')).toEqual({
      doc: v2Doc,
      editMetadata: 'migrate',
    });
    expect(migrate(v2Doc, 'v2').doc).toBe(v2Doc);

    // @ts-expect-error invalid initial doc type
    expect(migrate({})).toBeUndefined();
  });

  it('valid type', () => {
    type SavedDoc = { version: number };
    type Doc = { version: 2 };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type Migrate = MigrateDocFn<SavedDoc, Doc, any>;
  });

  it('invalid type', () => {
    type DocV1 = { version: 1 };
    type DocV2 = { version: 2 };
    type SavedDoc = DocV1;
    type Doc = DocV2;
    // @ts-expect-error State needs to be assignable to SavedDoc
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type Migrate = MigrateDocFn<SavedDoc, Doc, any>;
  });
});
