import React, { useRef } from 'react';

import styles from './Focus.module.css';
import { FocusCarets } from './FocusCarets';
import { UpdateCursorStateFn } from '../lib/trimergeHooks';
import { useFocusInfo, useSelectionListen } from './focusHooks';
import { CursorInfo } from 'trimerge-sync';
import { FocusCursorState } from '../lib/FocusCursorState';

export function FocusTextarea({
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
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, otherCursors } = useFocusInfo(id, cursors);
  const ref = useRef<HTMLTextAreaElement>(null);
  useSelectionListen(id, ref, updateCursor);

  return (
    <span className={styles.root} style={style}>
      <FocusCarets dom={ref.current} cursors={otherCursors} includeNames />
      <textarea ref={ref} {...rest} value={value} />
    </span>
  );
}
