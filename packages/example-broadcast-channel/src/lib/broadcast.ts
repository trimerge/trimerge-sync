import { BroadcastChannel } from 'broadcast-channel';
import { useEffect } from 'react';

export type BroadcastMessage =
  | {
      type: 'join';
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

const id = newId();
const bc = new BroadcastChannel<BroadcastMessage>(
  'trimerge-sync-broadcast-example',
);

bc.addEventListener('message', (message) => {
  console.log(`[BC] Received: <---`, message);
});

export function broadcast(message: BroadcastMessage) {
  console.log(`[BC] Sending: --->`, message);
  bc.postMessage(message);
}
broadcast({ type: 'join', id });
window.addEventListener('beforeunload', () => {
  broadcast({ type: 'leave', id });
});

// setInterval(() => {
//   broadcast({ type: '💗', id });
// }, 5_000);

export function useOnMessage(callback?: (message: BroadcastMessage) => void) {
  useEffect(() => {
    if (!callback) {
      return undefined;
    }
    bc.addEventListener('message', callback);
    return () => bc.removeEventListener('message', callback);
  });
}
