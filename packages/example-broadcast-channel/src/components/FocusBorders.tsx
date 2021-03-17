import styles from './Focus.module.css';
import materialColorHash from 'material-color-hash';
import React, { useMemo } from 'react';
import { CursorInfos } from 'trimerge-sync';
import { FocusCursorState } from '../lib/FocusCursorState';

export function FocusBorders<CursorState extends FocusCursorState>({
  cursors,
}: {
  cursors: CursorInfos<CursorState>;
}) {
  const style = useMemo(() => ({ left: `${-2 * cursors.length}px` }), [
    cursors.length,
  ]);
  if (cursors.length === 0) {
    return <></>;
  }

  return (
    <span className={styles.tagWrapper} style={style}>
      {cursors.map(({ userId, cursorId }) => {
        const key = userId + ':' + cursorId;
        const { color, backgroundColor } = materialColorHash(key, 500);
        return (
          <span
            key={key}
            className={styles.tag}
            style={{ color, backgroundColor }}
          >
            {cursorId}
          </span>
        );
      })}
    </span>
  );
}
