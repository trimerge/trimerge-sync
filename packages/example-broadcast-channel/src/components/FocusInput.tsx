import React, { useRef } from 'react';

import styles from './Focus.module.css';

import { UpdateCursorStateFn } from '../lib/trimergeHooks';
import { useFocusInfo, useSelectionListen } from './focusHooks';
import { FocusBorders } from './FocusBorders';
import { FocusCarets } from './FocusCarets';
import { CursorInfo } from 'trimerge-sync';
import { FocusCursorState } from '../lib/FocusCursorState';

export function FocusInput({
  id,
  value = '',
  cursors,
  updateCursor,
  ...rest
}: {
  id: string;
  value: string;
  cursors: readonly CursorInfo<FocusCursorState>[];
  updateCursor: UpdateCursorStateFn<FocusCursorState>;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, otherCursors } = useFocusInfo(id, cursors);
  const ref = useRef<HTMLInputElement>(null);
  useSelectionListen(id, ref, updateCursor);

  return (
    <span className={styles.root} style={style}>
      <FocusBorders cursors={otherCursors} />
      <FocusCarets dom={ref.current} cursors={otherCursors} />
      <input ref={ref} {...rest} value={value} disabled={rest.disabled} />
    </span>
  );
}
