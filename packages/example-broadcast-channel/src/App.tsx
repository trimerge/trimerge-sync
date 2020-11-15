import React, { useCallback, useState } from 'react';
import styles from './App.module.css';

import { useOnMessage } from './lib/broadcast';

export function App() {
  const [lastMessage, setLastMessage] = useState<string>('');
  useOnMessage(
    useCallback((message) => {
      setLastMessage(JSON.stringify(message));
    }, []),
  );
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.appName}>Trimerge Sync Broadcast Demo</div>
      </div>
      <div className={styles.main}>
        <div className={styles.userList}></div>
        <div>Last Message: {lastMessage}</div>
      </div>
    </div>
  );
}
