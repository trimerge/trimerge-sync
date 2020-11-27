import React, { useMemo } from 'react';
import classNames from 'classnames';
import { enableMapSet } from 'immer';

import styles from './App.module.css';

import {
  currentUserId,
  useCurrentLeader,
  useCurrentUsers,
} from './lib/broadcast';

enableMapSet();

export function App() {
  const currentLeaderId = useCurrentLeader();
  const currentUsers = useCurrentUsers();
  const users = useMemo(
    () =>
      currentUsers.map((userId) => (
        <span
          key={userId}
          className={classNames(styles.userPill, {
            [styles.currentUser]: userId === currentUserId,
          })}
        >
          {currentLeaderId === userId ? '👑' : '🤖'}
          {userId}
        </span>
      )),
    [currentLeaderId, currentUsers],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.appName}>Trimerge Sync Broadcast Demo</div>
      </div>
      <div className={styles.main}>
        <div className={styles.userList}>Online: {users}</div>
      </div>
    </div>
  );
}
