import { CSSProperties, useEffect, useMemo } from 'react';
import { CursorInfos } from 'trimerge-sync';
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
  cursors: CursorInfos<CursorState>,
): {
  style: CSSProperties;
  otherCursors: CursorInfos<CursorState>;
} {
  return useMemo(() => {
    const otherCursors = cursors.filter(
      ({ state, origin }) => origin !== 'self' && state?.focusId === id,
    );
    const boxShadow = otherCursors
      .map(
        (info, index) =>
          `0 0 0 ${2 * (1 + index)}px ${getCursorStyle(info).backgroundColor}`,
      )
      .join(',');
    otherCursors.reverse();
    return {
      style: { boxShadow },
      otherCursors,
    };
  }, [cursors, id]);
}
