import materialColorHash from 'material-color-hash';
import { CSSProperties, useMemo } from 'react';
import { StateWithUsers, updateUser } from 'trimerge-sync-user-state';
import { updateInputValueMovingSelection } from './update-cursor-positions';
import { UpdateStateFn } from '../lib/trimergeHooks';

export function useFocusInfo<State extends StateWithUsers>(
  id: string,
  currentUser: string,
  state: State,
): { style: CSSProperties; otherFocusedUserIds: readonly string[] } {
  const { users } = state;
  return useMemo(() => {
    const userIds = Object.keys(users);
    const otherFocusedUserIds = userIds.filter(
      (userId) => userId !== currentUser && users[userId].focusId === id,
    );
    const boxShadow = otherFocusedUserIds
      .map(
        (session, index) =>
          `0 0 0 ${2 * (1 + index)}px ${
            materialColorHash(session, 500).backgroundColor
          }`,
      )
      .join(',');
    otherFocusedUserIds.reverse();
    return {
      style: { boxShadow },
      otherFocusedUserIds: otherFocusedUserIds,
    };
  }, [currentUser, id, users]);
}

export function useUpdateFocus<State extends StateWithUsers, EditMetadata>(
  id: string,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
  currentUser: string,
  state: State,
  focusMetadata: EditMetadata,
  value: string,
  updateState: UpdateStateFn<State, EditMetadata> | undefined,
): undefined | (() => void) {
  const updateFocus = useMemo(() => {
    if (!updateState) {
      return undefined;
    }
    return () => {
      if (!ref.current) {
        return;
      }
      const { selectionStart, selectionEnd } = ref.current;
      return updateState(
        updateUser(state, currentUser, (draft) => {
          draft.focusId = id;
          draft.selectionStart =
            selectionStart === null ? undefined : selectionStart;
          draft.selectionEnd = selectionEnd === null ? undefined : selectionEnd;
        }),
        focusMetadata,
      );
    };
  }, [currentUser, focusMetadata, id, ref, state, updateState]);

  if (
    updateFocus &&
    ref.current &&
    updateInputValueMovingSelection(value, ref.current)
  ) {
    updateFocus();
  }
  return updateFocus;
}
