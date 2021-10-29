import { MigrateStateFn } from './differ';

describe('migrate type tests', () => {
  it('migrates', () => {
    type DocV1 = { version: 1; a: number };
    type DocV2 = { version: 2; b: number };
    type SavedState = DocV1 | DocV2;
    type State = DocV2;
    const migrate: MigrateStateFn<SavedState, State, string> = (
      state,
      editMetadata,
    ) => {
      switch (state.version) {
        case 1:
          return { state: { version: 2, b: state.a }, editMetadata: 'migrate' };
        case 2:
          // Up to date
          return { state, editMetadata };
      }
    };
    const v1Doc: DocV1 = { version: 1, a: 12 };
    const v2Doc: DocV2 = { version: 2, b: 12 };
    expect(migrate(v1Doc, 'v1')).toEqual({
      state: v2Doc,
      editMetadata: 'migrate',
    });
    expect(migrate(v2Doc, 'v2').state).toBe(v2Doc);

    // @ts-expect-error invalid initial doc type
    expect(migrate({})).toBeUndefined();
  });

  it('valid type', () => {
    type SavedState = { version: number };
    type State = { version: 2 };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type Migrate = MigrateStateFn<SavedState, State, any>;
  });

  it('invalid type', () => {
    type DocV1 = { version: 1 };
    type DocV2 = { version: 2 };
    type SavedState = DocV1;
    type State = DocV2;
    // @ts-expect-error State needs to be assignable to SavedState
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type Migrate = MigrateStateFn<SavedState, State, any>;
  });
});
