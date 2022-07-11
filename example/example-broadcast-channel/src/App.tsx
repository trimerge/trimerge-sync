import React, { useCallback, useMemo } from 'react';
import classNames from 'classnames';
import { enableMapSet, produce } from 'immer';

import styles from './App.module.css';

import {
  defaultDoc,
  useDemoAppClientList,
  useDemoAppDeleteDatabase,
  useDemoAppShutdown,
  useDemoAppDoc,
  useDemoAppSyncStatus,
} from './AppDoc';
import { FocusInput } from './components/FocusInput';
import { FocusTextarea } from './components/FocusTextarea';
import { currentTabId } from './lib/currentTabId';
import { getPresenceStyle } from './components/ClientColor';

enableMapSet();

export function App() {
  const [doc = defaultDoc, updateDoc] = useDemoAppDoc();
  const [clients, updatePresence] = useDemoAppClientList();
  const deleteDatabase = useDemoAppDeleteDatabase();
  const syncStatus = useDemoAppSyncStatus();
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
      updateDoc?.(
        produce(doc, (draft) => {
          draft.title = event.target.value;
        }),
        'edit title',
      ),
    [doc, updateDoc],
  );

  const onChangeSlider = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      updateDoc?.(
        produce(doc, (draft) => {
          draft.slider = parseInt(event.target.value, 10);
        }),
        'edit slider',
      ),
    [doc, updateDoc],
  );

  const onChangeText = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      updateDoc?.(
        produce(doc, (draft) => {
          draft.text = event.target.value;
        }),
        'edit text',
      ),
    [doc, updateDoc],
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
            value={doc.title}
            onChange={onChangeTitle}
            clients={clients}
            updatePresence={updatePresence}
          />
        </div>
        <div>
          A slider:{' '}
          <FocusInput
            id="slider"
            type="range"
            min="0"
            max="1000"
            value={String(doc.slider)}
            onChange={onChangeSlider}
            clients={clients}
            updatePresence={updatePresence}
          />{' '}
          ({doc.slider})
        </div>
        <FocusTextarea
          id="text"
          value={doc.text}
          onChange={onChangeText}
          rows={10}
          clients={clients}
          updatePresence={updatePresence}
        />
        <button onClick={deleteDatabase}>Delete Database…</button>
        Sync Status: <pre>{JSON.stringify(syncStatus, undefined, 2)}</pre>
        Raw State: <pre>{JSON.stringify(doc, undefined, 2)}</pre>
        Raw Clients: <pre>{JSON.stringify(clients, undefined, 2)}</pre>
      </div>
    </div>
  );
}
