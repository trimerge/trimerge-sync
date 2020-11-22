import { BroadcastChannel, createLeaderElection } from 'broadcast-channel';
import { useEffect, useState } from 'react';

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
      type: 'leader';
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
let currentLeaderId: string | undefined = undefined;
const currentUserSubscribers = new Set<(users: string[]) => void>();
const currentLeaderSubscribers = new Set<
  (leader: string | undefined) => void
>();

const broadcastChannel = new BroadcastChannel<BroadcastMessage>(
  'trimerge-sync-broadcast-example',
);
const elector = createLeaderElection(broadcastChannel);

function updateUsers() {
  const users = getCurrentUsers();
  for (const sub of currentUserSubscribers) {
    sub(users);
  }
}

function getLeader() {
  elector.awaitLeadership().then(() => {
    if (elector.isLeader) {
      broadcast({ type: 'leader', id: currentUserId });
      updateLeader(currentUserId);
    }
  });
}

function updateLeader(newLeaderId: string | undefined) {
  if (currentLeaderId === newLeaderId) {
    return;
  }
  if (newLeaderId === undefined) {
    getLeader();
  }
  currentLeaderId = newLeaderId;
  for (const sub of currentLeaderSubscribers) {
    sub(newLeaderId);
  }
}

getLeader();

broadcastChannel.addEventListener('message', (message) => {
  if (message.id === currentUserId) {
    console.warn(`[BC] ERRONEOUS ID`);
    return;
  }
  currentUsers.set(message.id, Date.now());
  switch (message.type) {
    case 'join':
      if (elector.isLeader) {
        broadcast({ type: 'leader', id: currentUserId });
      } else {
        broadcast({ type: 'here', id: currentUserId });
      }
      break;
    case 'leader':
      updateLeader(message.id);
      break;
    case 'leave':
      currentUsers.delete(message.id);
      if (message.id === currentLeaderId) {
        updateLeader(undefined);
      }
      break;
  }
  updateUsers();
});

export function broadcast(message: BroadcastMessage) {
  broadcastChannel.postMessage(message);
}
broadcast({ type: 'join', id: currentUserId });
window.addEventListener('beforeunload', () => {
  broadcast({ type: 'leave', id: currentUserId });
  elector.die();
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

export function getCurrentUsers() {
  return Array.from(currentUsers.keys());
}

export function useCurrentUsers(): string[] {
  const [users, setCurrentUsers] = useState(getCurrentUsers());
  useEffect(() => {
    currentUserSubscribers.add(setCurrentUsers);
    return () => {
      currentUserSubscribers.delete(setCurrentUsers);
    };
  }, []);
  return users;
}
export function useCurrentLeader(): string | undefined {
  const [leaderId, setLeaderId] = useState(currentLeaderId);
  useEffect(() => {
    currentLeaderSubscribers.add(setLeaderId);
    return () => {
      currentLeaderSubscribers.delete(setLeaderId);
    };
  }, []);
  return leaderId;
}
