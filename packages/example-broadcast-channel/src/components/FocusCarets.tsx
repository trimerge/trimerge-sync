import getCaretCoordinates from 'textarea-caret';
import materialColorHash from 'material-color-hash';
import React, { useMemo } from 'react';
import { BaseUserState } from 'trimerge-sync-user-state';

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
            <FocusCaret
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
  // TODO: replace this with something that works with multiline selection on textarea
  //  Maybe using https://developer.mozilla.org/en-US/docs/Web/API/Range/getClientRects
  const { left: startCaretLeft, top: startCaretTop } = getCaretCoordinates(
    dom,
    selectionStart,
  );
  const { left: endCaretLeft } = getCaretCoordinates(dom, selectionEnd);
  return useMemo(() => {
    const { backgroundColor } = materialColorHash(userId, 500);
    return (
      <>
        {name && (
          <div
            style={{
              position: 'absolute',
              backgroundColor,
              opacity: 0.5,
              left: `${startCaretLeft}px`,
              bottom: `${startCaretTop - 3}px`,
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
            left: `${startCaretLeft}px`,
            width: `${Math.max(endCaretLeft - startCaretLeft, 2)}px`,
            top: `${startCaretTop - 3}px`,
            height: `1em`,
            zIndex: -1,
          }}
        />
      </>
    );
  }, [startCaretLeft, startCaretTop, endCaretLeft, name, userId]);
}
