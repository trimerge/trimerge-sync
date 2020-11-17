import React, { useCallback, useMemo, useState } from 'react';
import classNames from 'classnames';
import { enableMapSet } from 'immer';

import styles from './App.module.css';

import {
  currentUserId,
  useCurrentLeader,
  useCurrentUsers,
  useOnMessage,
} from './lib/broadcast';
import { useTrimergeState } from './lib/trimergeClient';
import { differ } from './lib/trimergeDiffer';

enableMapSet();

export function App() {
  const [lastMessage, setLastMessage] = useState<string>('');
  const currentLeaderId = useCurrentLeader();
  const currentUsers = useCurrentUsers();
  useOnMessage(
    useCallback((message) => {
      setLastMessage(JSON.stringify(message));
    }, []),
  );
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

  const [state, updateState] = useTrimergeState('demo', differ);
  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateState(event.target.value, 'typing');
    },
    [updateState],
  );
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.appName}>Trimerge Sync Broadcast Demo</div>
      </div>
      <div className={styles.main}>
        <div className={styles.userList}>Online: {users}</div>
        <div>Last Message: {lastMessage}</div>
        <pre>
          State: <textarea value={String(state)} onChange={onChange} />
        </pre>
      </div>
    </div>
  );
}
