import { BasicServer } from './server';
import { join } from 'path';
import { mkdirpSync } from 'fs-extra';
import { SqliteDocStore } from './lib/SqliteDocStore';
import { Logger } from './types';

const dataDir = join(__dirname, '..', '_data');
mkdirpSync(dataDir);

// For the sample server, we just pass the stuff
type FakeAuth = { userId: string; readonly: boolean };
function isFakeAuth(auth: unknown): auth is FakeAuth {
  return auth ? typeof (auth as any).userId === 'string' : false;
}

function makeLogger(sharedParams: Record<string, any>): Logger {
  return {
    debug(message, params): void {
      console.log('[debug]', message, { ...params, ...sharedParams });
    },
    info(message, params): void {
      console.info('[info]', message, { ...params, ...sharedParams });
    },
    warn(message, params): void {
      console.warn('[warn]', message, { ...params, ...sharedParams });
    },
  };
}

function parseUrlDocId(uri: string): string {
  const docId = uri.split('/').find((x) => x);
  if (docId && /^[A-Z0-9_-]{1,50}$/i.test(docId)) {
    return docId;
  }
  throw new Error('invalid docId');
}

let connectionId = 0;

const server = new BasicServer(
  parseUrlDocId,
  async (docId, auth) => {
    if (!isFakeAuth(auth)) {
      throw new Error('invalid auth');
    }
    return auth;
  },
  (docId) => new SqliteDocStore(docId, dataDir),
  makeLogger({}),
  (docId) =>
    makeLogger({
      connectionId: (++connectionId).toString(16),
      docId,
    }),
);
server.attach({ port: 4444 });
