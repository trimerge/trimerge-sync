import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import { enableMapSet } from 'immer';

import styles from './App.module.css';

import { currentUserId, useCurrentUsers, useOnMessage } from './lib/broadcast';

enableMapSet();

export function App() {
  const [lastMessage, setLastMessage] = useState<string>('');
  const currentUsers = useCurrentUsers();
  useOnMessage(
    useCallback((message) => {
      setLastMessage(JSON.stringify(message));
    }, []),
  );
  const users = useMemo(
    () =>
      Array.from(currentUsers.entries()).map(([userId, age]) => (
        <span
          key={userId}
          className={classNames(styles.userPill, {
            [styles.currentUser]: userId === currentUserId,
          })}
        >
          {userId}
        </span>
      )),
    [currentUsers],
  );
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.appName}>Trimerge Sync Broadcast Demo</div>
      </div>
      <div className={styles.main}>
        <div className={styles.userList}>Online: {users}</div>
        <div>Last Message: {lastMessage}</div>
      </div>
    </div>
  );
}
