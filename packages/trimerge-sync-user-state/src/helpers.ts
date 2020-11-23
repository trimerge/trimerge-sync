import { BaseUserState, StateWithUsers } from './type';
import { Draft, produce } from 'immer';

export function updateUser<State extends StateWithUsers>(
  state: State,
  userId: string,
  recipe: (draft: Draft<BaseUserState>) => void,
) {
  return produce(state, (draft) => {
    let user = draft.users[userId];
    const lastUpdate = Date.now();
    if (user) {
      user.lastUpdate = lastUpdate;
    } else {
      draft.users[userId] = user = { lastUpdate };
    }
    recipe(user);
  });
}
