import { Server } from 'ws';
import { parse } from 'querystring';
import {
  addConnection,
  broadcastConnection,
  removeConnection,
  socketLog,
} from './sockets';

const wss = new Server({ port: 4444 });

wss.on('listening', () => {
  console.log('listening on: %s', wss.address());
});

wss.on('connection', (ws, req) => {
  try {
    socketLog(ws, 'connected:', req.url);
    if (!req.url) {
      throw new Error('no url');
    }
    const [, docId, query = ''] =
      /^\/+([^\/?]+)\/?.*?(?:\?(.+))?/.exec(req.url) ?? [];
    if (!docId) {
      throw new Error('invalid url');
    }
    const params = parse(query);
    if (!params.userId) {
      throw new Error('missing userId');
    }

    socketLog(ws, `added docId: ${docId}, params:`, params);
    addConnection(docId, ws);
    ws.on('message', (message) => {
      if (typeof message !== 'string') {
        socketLog(ws, "ws.close(1003, 'unsupported data');");
        ws.close(1003, 'unsupported data');
        return;
      }
      if (message.length > 1_000_000) {
        socketLog(ws, "ws.close(1009, 'payload too big');");
        ws.close(1009, 'payload too big');
        return;
      }
      socketLog(ws, 'received', message);
      broadcastConnection(docId, ws, message);
    });
    ws.on('close', () => {
      socketLog(ws, 'closed');
      removeConnection(docId, ws);
    });
  } catch (e) {
    socketLog(ws, 'error:', e);
    ws.close();
  }
});
