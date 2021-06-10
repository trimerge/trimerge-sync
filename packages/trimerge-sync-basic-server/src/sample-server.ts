import { BasicServer } from './server';
import { join } from 'path';
import { mkdirpSync } from 'fs-extra';
import { SqliteDocStore } from './lib/SqliteDocStore';

const dataDir = join(__dirname, '..', '_data');
mkdirpSync(dataDir);

// For the sample server, we just pass the stuff
type FakeAuth = { userId: string; readonly: boolean };
function isFakeAuth(auth: unknown): auth is FakeAuth {
  return auth ? typeof (auth as any).userId === 'string' : false;
}

new BasicServer(
  async (docId, auth) => {
    if (!isFakeAuth(auth)) {
      throw new Error('invalid auth');
    }
    return auth;
  },
  (docId) => new SqliteDocStore(docId, dataDir),
).listen(4444);
