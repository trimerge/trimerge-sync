import React, { useRef } from 'react';

import styles from './Focus.module.css';
import { FocusCarets } from './FocusCarets';
import { UpdateStateFn } from '../lib/trimergeClient';
import { useFocusInfo, useUpdateFocus } from './focusHooks';
import { StateWithUsers } from 'trimerge-sync-user-state';

export function FocusTextarea<State extends StateWithUsers, EditMetadata>({
  id,
  value = '',
  currentUser,
  state,
  updateState,
  focusMetadata,
  ...rest
}: {
  id: string;
  value: string;
  state: State;
  updateState?: UpdateStateFn<State, EditMetadata>;
  focusMetadata: EditMetadata;
  currentUser: string;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { users } = state;
  const { style, otherFocusedUserIds } = useFocusInfo(id, currentUser, state);
  const ref = useRef<HTMLTextAreaElement>(null);
  const updateFocus = useUpdateFocus(
    id,
    ref,
    currentUser,
    state,
    focusMetadata,
    value,
    updateState,
  );

  return (
    <span className={styles.root} style={style}>
      <FocusCarets
        dom={ref.current}
        users={users}
        otherFocusedUserIds={otherFocusedUserIds}
        includeNames
      />
      <textarea
        ref={ref}
        {...rest}
        value={value}
        onSelect={updateFocus}
        onInput={updateFocus}
        onFocus={updateFocus}
      />
    </span>
  );
}
