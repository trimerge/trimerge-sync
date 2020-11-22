import styles from './Focus.module.css';
import materialColorHash from 'material-color-hash';
import React, { useMemo } from 'react';
import { BaseUserState } from 'trimerge-sync-user-state';

export function FocusBorders({
  users,
  otherFocusedUserIds,
}: {
  users: Record<string, BaseUserState>;
  otherFocusedUserIds: readonly string[];
}) {
  const style = useMemo(
    () => ({ left: `${-2 * otherFocusedUserIds.length}px` }),
    [otherFocusedUserIds.length],
  );
  if (otherFocusedUserIds.length === 0) {
    return <></>;
  }

  return (
    <span className={styles.tagWrapper} style={style}>
      {otherFocusedUserIds.map((session) => {
        const { name = 'Unknown' } = users[session];
        const { color, backgroundColor } = materialColorHash(session, 500);
        return (
          <span
            key={session}
            className={styles.tag}
            style={{ color, backgroundColor }}
          >
            {name}
          </span>
        );
      })}
    </span>
  );
}
