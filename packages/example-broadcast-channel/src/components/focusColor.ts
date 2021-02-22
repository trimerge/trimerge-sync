import { CursorInfo } from 'trimerge-sync';
import materialColorHash from 'material-color-hash';

export function getUserColor({ userId, cursorId }: CursorInfo<unknown>) {
  return materialColorHash(userId + ':' + cursorId, 500).backgroundColor;
}
