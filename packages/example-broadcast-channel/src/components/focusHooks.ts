import { CSSProperties, useEffect, useMemo } from 'react';
import { CursorInfo } from 'trimerge-sync';
import { UpdateCursorStateFn } from '../lib/trimergeHooks';
import { getCursorStyle } from './CursorColor';
import { FocusCursorState } from '../lib/FocusCursorState';

export function useSelectionListen(
  focusId: string,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
  updateCursor: UpdateCursorStateFn<FocusCursorState>,
) {
  useEffect(() => {
    const listener = () => {
      if (!ref.current || document.activeElement !== ref.current) {
        return;
      }
      const { selectionStart, selectionEnd } = ref.current;
      updateCursor({
        focusId,
        selectionStart: selectionStart === null ? undefined : selectionStart,
        selectionEnd: selectionEnd === null ? undefined : selectionEnd,
      });
    };
    document.addEventListener('selectionchange', listener, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', listener);
    };
  }, [focusId, ref, updateCursor]);
}

export function useFocusInfo<CursorState extends FocusCursorState>(
  id: string,
  cursors: readonly CursorInfo<CursorState>[],
): {
  style: CSSProperties;
  otherCursors: readonly CursorInfo<CursorState>[];
} {
  return useMemo(() => {
    const otherCursors = cursors.filter(
      ({ self, state }) => !self && state?.focusId === id,
    );
    otherCursors.reverse();
    const dashWidth = 10;
    return {
      style: {
        borderImage: `repeating-linear-gradient(-45deg, ${otherCursors
          .map((info, index) => {
            const color = getCursorStyle(info).backgroundColor;
            return `${color} ${dashWidth * index}px, ${color} ${
              dashWidth * (index + 1)
            }px`;
          })
          .join(',')}) ${dashWidth}/2px`,
        borderWidth: '3px',
        borderRadius: '10px',
      },
      otherCursors,
    };
  }, [cursors, id]);
}
