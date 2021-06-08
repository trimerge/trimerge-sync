import { Server } from 'ws';
import { addSocket } from './docs';

const wss = new Server({ port: 4444 });

wss.on('listening', () => {
  console.log('listening on: %s', wss.address());
});

let id = 0;

wss.on('connection', (ws, req) => {
  const connId = (id++).toString(16);
  try {
    console.log(`${connId}: new connection`);
    addSocket(ws, req.url, connId);
  } catch (e) {
    console.log(`${connId}: closing connection: ${e}`);
    ws.close();
  }
});
