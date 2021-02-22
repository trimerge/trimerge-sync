import { CSSProperties, useMemo } from 'react';
import { updateInputValueMovingSelection } from './update-cursor-positions';
import { CursorInfo } from 'trimerge-sync';
import { UpdateCursorStateFn } from '../lib/trimergeHooks';
import { getUserColor } from './focusColor';
import { FocusCursorState } from '../lib/FocusCursorState';

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
    const boxShadow = otherCursors
      .map((info, index) => `0 0 0 ${2 * (1 + index)}px ${getUserColor(info)}`)
      .join(',');
    otherCursors.reverse();
    return {
      style: { boxShadow },
      otherCursors,
    };
  }, [cursors, id]);
}

export function useUpdateFocus(
  focusId: string,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
  updateCursor: UpdateCursorStateFn<FocusCursorState>,
  value: string,
): undefined | (() => void) {
  const updateFocus = useMemo(() => {
    return () => {
      if (!ref.current) {
        return;
      }
      const { selectionStart, selectionEnd } = ref.current;
      return updateCursor({
        focusId,
        selectionStart: selectionStart === null ? undefined : selectionStart,
        selectionEnd: selectionEnd === null ? undefined : selectionEnd,
      });
    };
  }, [focusId, ref, updateCursor]);

  if (
    updateFocus &&
    ref.current &&
    updateInputValueMovingSelection(value, ref.current)
  ) {
    updateFocus();
  }
  return updateFocus;
}
