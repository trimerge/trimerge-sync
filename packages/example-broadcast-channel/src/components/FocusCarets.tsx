import getCaretCoordinates from 'textarea-caret';
import materialColorHash from 'material-color-hash';
import React from 'react';
import { BaseUserState } from 'trimerge-sync-user-state';
import styles from './Focus.module.css';

export function FocusCarets({
  dom,
  users,
  otherFocusedUserIds,
  includeNames = false,
}: {
  dom: HTMLInputElement | HTMLTextAreaElement | null;
  users: Record<string, BaseUserState>;
  otherFocusedUserIds: readonly string[];
  includeNames?: boolean;
}) {
  return (
    <>
      {dom &&
        otherFocusedUserIds.map((userId) => {
          const { name, selectionStart, selectionEnd } = users[userId];
          if (selectionStart === undefined || selectionEnd === undefined) {
            return null;
          }
          return (
            <MemoizedFocusCaret
              key={userId}
              dom={dom}
              name={includeNames ? name : undefined}
              userId={userId}
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
  userId,
  name,
  selectionStart,
  selectionEnd,
}: {
  dom: HTMLInputElement | HTMLTextAreaElement;
  userId: string;
  name?: string;
  selectionStart: number;
  selectionEnd: number;
}) {
  const startCaret = getCaretCoordinates(dom, selectionStart);
  const endCaret = getCaretCoordinates(dom, selectionEnd);
  const { backgroundColor } = materialColorHash(userId, 500);
  return (
    <>
      {name && (
        <div
          style={{
            position: 'absolute',
            backgroundColor,
            opacity: 0.5,
            left: `${startCaret.left}px`,
            bottom: `${startCaret.top - 3}px`,
          }}
        >
          {name}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          backgroundColor,
          opacity: 0.5,
          left: `${startCaret.left}px`,
          width: `${Math.max(endCaret.left - startCaret.left, 2)}px`,
          top: `${startCaret.top - 3}px`,
          height: `1em`,
          zIndex: -1,
        }}
      />
    </>
  );
}
const MemoizedFocusCaret = React.memo(FocusCaret);
