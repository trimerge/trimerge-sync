import React, { useRef } from 'react';

import styles from './Focus.module.css';
import { FocusCarets } from './FocusCarets';
import { UpdatePresenceFn } from '../lib/trimergeHooks';
import { useFocusInfo, useSelectionListen } from './focusHooks';
import { ClientList } from 'trimerge-sync';
import { FocusPresence } from '../lib/FocusPresence';

export function FocusTextarea({
  id,
  value = '',
  clients,
  updatePresence,
  ...rest
}: {
  id: string;
  value: string;
  clients: ClientList<FocusPresence>;
  updatePresence: UpdatePresenceFn<FocusPresence>;
} & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { style, otherClients } = useFocusInfo(id, clients);
  const ref = useRef<HTMLTextAreaElement>(null);
  useSelectionListen(id, ref, updatePresence);

  return (
    <span className={styles.root} style={style}>
      <FocusCarets dom={ref.current} clients={otherClients} includeNames />
      <textarea ref={ref} {...rest} value={value} />
    </span>
  );
}
