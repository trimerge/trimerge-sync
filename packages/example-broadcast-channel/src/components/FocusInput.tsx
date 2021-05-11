import React, { useRef } from 'react';

import styles from './Focus.module.css';

import { UpdatePresenceFn } from '../lib/trimergeHooks';
import { useFocusInfo, useSelectionListen } from './focusHooks';
import { FocusBorders } from './FocusBorders';
import { FocusCarets } from './FocusCarets';
import { FocusPresenceState } from '../lib/FocusPresenceState';
import { ClientList } from 'trimerge-sync';

export function FocusInput({
  id,
  value = '',
  clients,
  updatePresence,
  ...rest
}: {
  id: string;
  value: string;
  clients: ClientList<FocusPresenceState>;
  updatePresence: UpdatePresenceFn<FocusPresenceState>;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const { style, otherClients } = useFocusInfo(id, clients);
  const ref = useRef<HTMLInputElement>(null);
  useSelectionListen(id, ref, updatePresence);

  return (
    <span className={styles.root} style={style}>
      <FocusBorders clients={otherClients} />
      <FocusCarets dom={ref.current} clients={otherClients} />
      <input ref={ref} {...rest} value={value} disabled={rest.disabled} />
    </span>
  );
}
