import React, { useRef } from 'react';
import { StateWithUsers } from 'trimerge-sync-user-state';

import styles from './Focus.module.css';

import { UpdateStateFn } from '../lib/trimergeClient';
import { useFocusInfo, useUpdateFocus } from './focusHooks';
import { FocusBorders } from './FocusBorders';
import { FocusCarets } from './FocusCarets';

export function FocusInput<State extends StateWithUsers, EditMetadata>({
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
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const { users } = state;
  const { style, otherFocusedUserIds } = useFocusInfo(id, currentUser, state);
  const ref = useRef<HTMLInputElement>(null);
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
      <FocusBorders users={users} otherFocusedUserIds={otherFocusedUserIds} />
      <FocusCarets
        dom={ref.current}
        users={users}
        otherFocusedUserIds={otherFocusedUserIds}
      />
      <input
        ref={ref}
        {...rest}
        value={value}
        onSelect={updateFocus}
        onInput={updateFocus}
        onFocus={updateFocus}
        onBlur={updateFocus}
        disabled={rest.disabled || !updateState}
      />
    </span>
  );
}
