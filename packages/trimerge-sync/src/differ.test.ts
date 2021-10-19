import { MigrateStateFn } from './differ';

describe('migrate type tests', () => {
  it('migrates', () => {
    type DocV1 = { version: 1 };
    type DocV2 = { version: 2 };
    type SavedState = DocV1 | DocV2;
    type State = DocV2;
    const migrate: MigrateStateFn<SavedState, State> = (state) => {
      switch (state.version) {
        case 1:
          return { ...state, version: 2 };
        case 2:
          return state;
      }
    };
    const v1Doc: DocV1 = { version: 1 };
    const v2Doc: DocV2 = { version: 2 };
    expect(migrate(v1Doc)).toEqual(v2Doc);
    expect(migrate(v2Doc)).toBe(v2Doc);

    // @ts-expect-error invalid initial doc type
    expect(migrate({})).toBeUndefined();
  });
  it('valid type', () => {
    type SavedState = { version: number };
    type State = { version: 2 };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type Migrate = MigrateStateFn<SavedState, State>;
  });
  it('invalid type', () => {
    type DocV1 = { version: 1 };
    type DocV2 = { version: 2 };
    type SavedState = DocV1;
    type State = DocV2;
    // @ts-expect-error State needs to be assignable to SavedState
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    type Migrate = MigrateStateFn<SavedState, State>;
  });
});
