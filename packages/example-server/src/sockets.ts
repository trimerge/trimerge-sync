import WebSocket from 'ws';
import generate from 'project-name-generator';

export const docSockets = new Map<string, Set<WebSocket>>();
const socketIds = new WeakMap<WebSocket, string>();

export function addConnection(docId: string, ws: WebSocket) {
  const sockets = docSockets.get(docId);
  if (sockets) {
    sockets.add(ws);
  } else {
    docSockets.set(docId, new Set([ws]));
  }
}

export function removeConnection(docId: string, ws: WebSocket) {
  const sockets = docSockets.get(docId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) {
      docSockets.delete(docId);
    }
  }
}

export function broadcastConnection(
  docId: string,
  ws: WebSocket,
  message: any,
) {
  const sockets = docSockets.get(docId);
  if (sockets) {
    for (const socket of sockets) {
      if (socket !== ws) {
        socketLog(socket, 'broadcasting', message);
        socket.send(message);
      }
    }
  }
}
export function socketLog(ws: WebSocket, ...args: any[]) {
  let id = socketIds.get(ws);
  if (!id) {
    id = generate({ words: 3 }).dashed;
    socketIds.set(ws, id);
  }
  console.log(`[${id}]`, ...args);
}
