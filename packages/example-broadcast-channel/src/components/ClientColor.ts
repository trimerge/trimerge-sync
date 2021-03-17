import { ClientInfo } from 'trimerge-sync';
import materialColorHash from 'material-color-hash';

export function getPresenceStyle({ userId, clientId }: ClientInfo<unknown>) {
  return materialColorHash(userId + ':' + clientId, 500);
}
