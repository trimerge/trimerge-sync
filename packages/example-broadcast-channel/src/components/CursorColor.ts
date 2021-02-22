import { CursorInfo } from 'trimerge-sync';
import materialColorHash from 'material-color-hash';

export function getCursorStyle({ userId, cursorId }: CursorInfo<unknown>) {
  return materialColorHash(userId + ':' + cursorId, 500);
}
