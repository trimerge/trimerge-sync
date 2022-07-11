import { CSSProperties, useEffect, useMemo } from 'react';
import { ClientList } from 'trimerge-sync';
import { UpdatePresenceFn } from '../lib/trimergeHooks';
import { getPresenceStyle } from './ClientColor';
import { FocusPresence } from '../lib/FocusPresence';

export function useSelectionListen(
  focusId: string,
  ref: React.RefObject<HTMLInputElement | HTMLTextAreaElement>,
  updatePresence: UpdatePresenceFn<FocusPresence>,
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

export function useFocusInfo<Presence extends FocusPresence>(
  id: string,
  cursors: ClientList<Presence>,
): {
  style: CSSProperties;
  otherClients: ClientList<Presence>;
} {
  return useMemo(() => {
    const otherClients = cursors.filter(
      ({ presence, self }) => !self && presence?.focusId === id,
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
