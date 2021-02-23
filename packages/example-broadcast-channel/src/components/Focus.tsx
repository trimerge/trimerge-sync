import React, { useCallback } from 'react';

import styles from './Focus.module.css';
import { UpdateCursorStateFn } from '../lib/trimergeHooks';
import { useFocusInfo } from './focusHooks';
import { FocusBorders } from './FocusBorders';
import { CursorInfo } from 'trimerge-sync';
import { FocusCursorState } from '../lib/FocusCursorState';

export function Focus({
  id,
  cursors,
  updateCursor,
  children,
}: {
  id: string;
  cursors: readonly CursorInfo<FocusCursorState>[];
  updateCursor: UpdateCursorStateFn<FocusCursorState>;
  children: React.ReactNode;
}) {
  const onFocus = useCallback(() => {
    updateCursor({ focusId: id });
  }, [id, updateCursor]);
  const { style, otherCursors } = useFocusInfo(id, cursors);
  return (
    <span
      onClick={onFocus}
      onFocus={onFocus}
      className={styles.root}
      style={style}
    >
      <FocusBorders cursors={otherCursors} />
      {children}
    </span>
  );
}
