import React, { useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { enableMapSet, produce } from 'immer';

import styles from './App.module.css';

import {
  defaultState,
  useDemoAppClientList,
  useDemoAppShutdown,
  useDemoAppState,
} from './AppState';
import { FocusInput } from './components/FocusInput';
import { FocusTextarea } from './components/FocusTextarea';
import { currentTabId } from './lib/currentTabId';
import { getPresenceStyle } from './components/ClientColor';

enableMapSet();

export function App() {
  const [state = defaultState, updateState] = useDemoAppState();
  const [clients, updatePresence] = useDemoAppClientList();
  useDemoAppShutdown();

  const users = useMemo(
    () =>
      Array.from(clients)
        .sort((a, b) => {
          if (a.clientId < b.clientId) {
            return -1;
          }
          if (a.clientId > b.clientId) {
            return 1;
          }
          return 0;
        })
        .map((cursor) => (
          <span
            key={cursor.clientId}
            className={classNames(styles.userPill, {
              [styles.currentUser]: cursor.clientId === currentTabId,
            })}
            style={getPresenceStyle(cursor)}
          >
            {currentTabId === cursor.clientId ? '👑' : '🤖'}
            {cursor.clientId}
          </span>
        )),
    [clients],
  );

  const onChangeTitle = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      updateState?.(
        produce(state, (draft) => {
          draft.title = event.target.value;
        }),
        'edit title',
      ),
    [state, updateState],
  );

  const onChangeText = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      updateState?.(
        produce(state, (draft) => {
          draft.text = event.target.value;
        }),
        'edit text',
      ),
    [state, updateState],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.appName}>Trimerge Sync Broadcast Demo</div>
      </div>
      <div className={styles.main}>
        <div className={styles.userList}>Online: {users}</div>
        <div>
          Title:{' '}
          <FocusInput
            id="title"
            value={state.title}
            onChange={onChangeTitle}
            clients={clients}
            updatePresence={updatePresence}
          />
        </div>
        <FocusTextarea
          id="text"
          value={state.text}
          onChange={onChangeText}
          rows={10}
          clients={clients}
          updatePresence={updatePresence}
        />
        Raw State: <pre>{JSON.stringify(state, undefined, 2)}</pre>
        Raw Clients: <pre>{JSON.stringify(clients, undefined, 2)}</pre>
      </div>
    </div>
  );
}
