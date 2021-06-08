import { CSSProperties, useEffect, useMemo } from 'react';
import { ClientList } from 'trimerge-sync';
import { UpdatePresenceFn } from '../lib/trimergeHooks';
import { getPresenceStyle } from './ClientColor';
import { FocusPresenceState } from '../lib/FocusPresenceState';

export function useSelectionListen(
  focusId: string,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
  updatePresence: UpdatePresenceFn<FocusPresenceState>,
) {
  useEffect(() => {
    const listener = () => {
      if (!ref.current || document.activeElement !== ref.current) {
        return;
      }
      const { selectionStart, selectionEnd } = ref.current;
      updatePresence({
        focusId,
        selectionStart: selectionStart === null ? undefined : selectionStart,
        selectionEnd: selectionEnd === null ? undefined : selectionEnd,
      });
    };
    document.addEventListener('selectionchange', listener, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', listener);
    };
  }, [focusId, ref, updatePresence]);
}

export function useFocusInfo<PresenceState extends FocusPresenceState>(
  id: string,
  cursors: ClientList<PresenceState>,
): {
  style: CSSProperties;
  otherClients: ClientList<PresenceState>;
} {
  return useMemo(() => {
    const otherClients = cursors.filter(
      ({ state, self }) => !self && state?.focusId === id,
    );
    const boxShadow = otherClients
      .map(
        (info, index) =>
          `0 0 0 ${2 * (1 + index)}px ${
            getPresenceStyle(info).backgroundColor
          }`,
      )
      .join(',');
    otherClients.reverse();
    return {
      style: { boxShadow },
      otherClients,
    };
  }, [cursors, id]);
}
