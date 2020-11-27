import P2pt, { Peer } from 'p2pt';
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

var p2pt = new P2pt(
  // Find public WebTorrent tracker URLs here : https://github.com/ngosang/trackerslist/blob/master/trackers_all_ws.txt
  [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.sloppyta.co:443/announce',
    'wss://tracker.magnetoo.io:443/announce',
  ],
  'trimerge-sync:webrtc-demo',
);

export const currentUserId = p2pt._peerId;
let currentUsers = new Map<string, number>([[currentUserId, Date.now()]]);
let peers = new Set<Peer>();
let currentLeaderId: string | undefined = undefined;
const currentUserSubscribers = new Set<(users: string[]) => void>();
const currentLeaderSubscribers = new Set<
  (leader: string | undefined) => void
>();

function updateUsers() {
  const users = getCurrentUsers();
  for (const sub of currentUserSubscribers) {
    sub(users);
  }
}

function scanPeers() {
  for (const peerId of Object.keys(p2pt.peers)) {
    for (const connectionId of Object.keys(p2pt.peers[peerId])) {
      const peer = p2pt.peers[peerId][connectionId];
      if (!peers.has(peer)) {
        console.log(`found peer`, peer.id);
        currentUsers.set(peer.id, Date.now());
        peers.add(peer);
        p2pt.send(peer, { type: 'here', id: currentUserId });
        updateUsers();
      }
    }
  }
}

p2pt.on('msg', (peer, message: BroadcastMessage) => {
  console.log(`msg`, peer.id, message);
  if (message.id === currentUserId) {
    console.warn(`[BC] ERRONEOUS ID`);
    return;
  }
  currentUsers.set(message.id, Date.now());
  switch (message.type) {
    case 'join':
      broadcast({ type: 'here', id: currentUserId });
      peers.add(peer);
      break;
    case 'leave':
      currentUsers.delete(message.id);
      peers.delete(peer);
      break;
  }
  updateUsers();
  scanPeers();
});
p2pt.on('peerclose', (peer) => {
  console.log(`peerclose`, peer.id);
  currentUsers.delete(peer.id);
  peers.delete(peer);
  updateUsers();
  scanPeers();
});
p2pt.on('trackerconnect', (websocketTracker, stats) => {
  console.log(`trackerconnect`, stats);
  scanPeers();
});
p2pt.on('trackerwarning', (error, stats) => {
  console.log(`trackerwarning`, error);
});
p2pt.start();

export function broadcast(message: BroadcastMessage) {
  for (const peer of peers) {
    p2pt.send(peer, message);
  }
}
broadcast({ type: 'join', id: currentUserId });
window.addEventListener('beforeunload', () => {
  broadcast({ type: 'leave', id: currentUserId });
  p2pt.destroy();
});

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
