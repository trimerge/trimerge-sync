import React, { useMemo } from 'react';

import styles from './Focus.module.css';
import { StateWithUsers, updateUser } from 'trimerge-sync-user-state';
import { UpdateStateFn } from '../lib/trimergeHooks';
import { useFocusInfo } from './focusHooks';
import { FocusBorders } from './FocusBorders';

export function Focus<State extends StateWithUsers, EditMetadata>({
  id,
  state,
  updateState,
  currentUser,
  focusMetadata,
  children,
}: {
  id: string;
  state: State;
  updateState?: UpdateStateFn<State, EditMetadata>;
  focusMetadata: EditMetadata;
  currentUser: string;
  children: React.ReactNode;
}) {
  const { users } = state;
  const onFocus = useMemo(
    () =>
      updateState &&
      (() =>
        updateState(
          updateUser(state, currentUser, (draft) => {
            draft.focusId = id;
          }),
          focusMetadata,
        )),
    [currentUser, focusMetadata, id, state, updateState],
  );
  const { style, otherFocusedUserIds } = useFocusInfo(id, currentUser, state);
  return (
    <span
      onClick={onFocus}
      onFocus={onFocus}
      className={styles.root}
      style={style}
    >
      <FocusBorders users={users} otherFocusedUserIds={otherFocusedUserIds} />
      {children}
    </span>
  );
}
