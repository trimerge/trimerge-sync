import styles from './Focus.module.css';
import materialColorHash from 'material-color-hash';
import React, { useMemo } from 'react';
import { ClientList } from 'trimerge-sync';
import { FocusPresence } from '../lib/FocusPresence';

export function FocusBorders<Presence extends FocusPresence>({
  clients,
}: {
  clients: ClientList<Presence>;
}) {
  const style = useMemo(
    () => ({ left: `${-2 * clients.length}px` }),
    [clients.length],
  );
  if (clients.length === 0) {
    return <></>;
  }

  return (
    <span className={styles.tagWrapper} style={style}>
      {clients.map(({ userId, clientId }) => {
        const key = userId + ':' + clientId;
        const { color, backgroundColor } = materialColorHash(key, 500);
        return (
          <span
            key={key}
            className={styles.tag}
            style={{ color, backgroundColor }}
          >
            {clientId}
          </span>
        );
      })}
    </span>
  );
}
