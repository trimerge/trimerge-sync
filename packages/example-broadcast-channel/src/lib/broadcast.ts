import { BroadcastChannel } from 'broadcast-channel';
import { useEffect, useState } from 'react';
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

let currentUsers = new Map<string, number>([[currentUserId, Date.now()]]);
const currentUserSubscribers = new Set<() => void>();

const bc = new BroadcastChannel<BroadcastMessage>(
  'trimerge-sync-broadcast-example',
);

function updateUsers() {
  for (const sub of currentUserSubscribers) {
    sub();
  }
}

bc.addEventListener('message', (message) => {
  console.log(`[BC] Received: <---`, message);
  if (message.id === currentUserId) {
    console.warn(`[BC] ERRONEOUS ID`);
    return;
  }
  switch (message.type) {
    case 'join':
      broadcast({ type: 'here', id: currentUserId });
      currentUsers.set(message.id, Date.now());
      updateUsers();
      break;
    case 'here':
    case '💗':
      currentUsers.set(message.id, Date.now());
      updateUsers();
      break;
    case 'leave':
      currentUsers.delete(message.id);
      updateUsers();
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
  let deletes = false;
  const expire = Date.now() - 5_000;
  for (const [userId, age] of currentUsers) {
    if (userId !== currentUserId && age < expire) {
      currentUsers.delete(userId);
      deletes = true;
    }
  }
  if (deletes) {
    updateUsers();
  }
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

export function useCurrentUsers(): string[] {
  const [users, setCurrentUsers] = useState(Array.from(currentUsers.keys()));
  useEffect(() => {
    function update() {
      setCurrentUsers(Array.from(currentUsers.keys()));
    }
    currentUserSubscribers.add(update);
    return () => {
      currentUserSubscribers.delete(update);
    };
  });
  return users;
}
