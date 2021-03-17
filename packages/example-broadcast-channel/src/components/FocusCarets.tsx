import getCaretCoordinates from 'textarea-caret';
import materialColorHash from 'material-color-hash';
import React, { useMemo } from 'react';
import { ClientList } from 'trimerge-sync';
import { FocusPresenceState } from '../lib/FocusPresenceState';
import styles from './Focus.module.css';

export function FocusCarets<PresenceState extends FocusPresenceState>({
  dom,
  clients,
  includeNames = false,
}: {
  dom: HTMLInputElement | HTMLTextAreaElement | null;
  clients: ClientList<PresenceState>;
  includeNames?: boolean;
}) {
  return (
    <>
      {dom &&
        clients.map(({ userId, clientId, state }) => {
          const selectionStart = state?.selectionStart;
          const selectionEnd = state?.selectionEnd;
          if (selectionStart === undefined || selectionEnd === undefined) {
            return null;
          }
          const fullId = userId + ':' + clientId;
          return (
            <FocusCaret
              key={fullId}
              dom={dom}
              name={includeNames ? clientId : undefined}
              id={fullId}
              selectionStart={selectionStart}
              selectionEnd={selectionEnd}
            />
          );
        })}
    </>
  );
}

function FocusCaret({
  dom,
  id,
  name,
  selectionStart,
  selectionEnd,
}: {
  dom: HTMLInputElement | HTMLTextAreaElement;
  id: string;
  name?: string;
  selectionStart: number;
  selectionEnd: number;
}) {
  // TODO: replace this with something that works with multiline selection on textarea
  //  Maybe using https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects
  const { left: startCaretLeft, top: startCaretTop } = getCaretCoordinates(
    dom,
    selectionStart,
  );
  const { left: endCaretLeft } = getCaretCoordinates(dom, selectionEnd);
  return useMemo(() => {
    const style = materialColorHash(id, 500);
    return (
      <>
        <div
          className={styles.caret}
          style={{
            ...style,
            left: `${startCaretLeft}px`,
            width: `${Math.max(endCaretLeft - startCaretLeft, 2)}px`,
            top: `${startCaretTop - 3}px`,
          }}
        >
          {name && (
            <div className={styles.caretName} style={style}>
              {name}
            </div>
          )}
        </div>
      </>
    );
  }, [startCaretLeft, startCaretTop, endCaretLeft, name, id]);
}
