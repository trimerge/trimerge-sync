import { BroadcastChannel } from 'broadcast-channel';
import { useEffect } from 'react';
import { produce } from 'immer';

export type BroadcastMessage =
  | {
      type: 'join';
      id: string;
    }
  | {
      type: 'here';
      id: string;
    }
  | {
      type: '💗';
      id: string;
    }
  | {
      type: 'leave';
      id: string;
    };

function newId() {
  return btoa(
    String.fromCharCode(
      ...Array.from(crypto.getRandomValues(new Uint8Array(12))),
    ),
  );
}

export const currentUserId = newId();

let currentUsers: ReadonlyMap<string, number> = new Map([
  [currentUserId, Date.now()],
]);

const bc = new BroadcastChannel<BroadcastMessage>(
  'trimerge-sync-broadcast-example',
);

bc.addEventListener('message', (message) => {
  console.log(`[BC] Received: <---`, message);
  if (message.id === currentUserId) {
    console.warn(`[BC] ERRONEOUS ID`);
    return;
  }
  switch (message.type) {
    case 'join':
      broadcast({ type: 'here', id: currentUserId });
      currentUsers = produce(currentUsers, (draft) => {
        draft.set(message.id, Date.now());
      });
      break;
    case 'here':
    case '💗':
      currentUsers = produce(currentUsers, (draft) => {
        draft.set(message.id, Date.now());
      });
      break;
    case 'leave':
      currentUsers = produce(currentUsers, (draft) => {
        draft.delete(message.id);
      });
      break;
  }
});

export function broadcast(message: BroadcastMessage) {
  console.log(`[BC] Sending: --->`, message);
  bc.postMessage(message);
}
broadcast({ type: 'join', id: currentUserId });
window.addEventListener('beforeunload', () => {
  broadcast({ type: 'leave', id: currentUserId });
});

setInterval(() => {
  broadcast({ type: '💗', id: currentUserId });
  currentUsers = produce(currentUsers, (draft) => {
    const expire = Date.now() - 5_000;
    for (const [userId, age] of currentUsers) {
      if (userId !== currentUserId && age < expire) {
        draft.delete(userId);
      }
    }
  });
}, 2_500);

export function useOnMessage(callback?: (message: BroadcastMessage) => void) {
  useEffect(() => {
    if (!callback) {
      return undefined;
    }
    bc.addEventListener('message', callback);
    return () => bc.removeEventListener('message', callback);
  });
}

export function useCurrentUsers() {
  return currentUsers;
}
