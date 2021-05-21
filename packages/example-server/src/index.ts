import { Server } from 'ws';
import { addSocket } from './docs';

const wss = new Server({ port: 4444 });

wss.on('listening', () => {
  console.log('listening on: %s', wss.address());
});

wss.on('connection', (ws, req) => {
  try {
    addSocket(ws, req.url);
  } catch (e) {
    ws.close();
  }
});
