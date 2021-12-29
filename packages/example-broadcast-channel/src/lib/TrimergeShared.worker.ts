// this is the code for the singleton live collab worker shared across all
// windows.

import { LocalStore, Remote, SyncEvent, TrimergeClient } from 'trimerge-sync';
import { WebsocketRemote } from 'trimerge-sync-basic-client';
import { createIndexedDbBackendFactory } from 'trimerge-sync-indexed-db';
import { randomId } from './randomId';

console.log('initialize shared worker');

const clientId = randomId();

type LiveDoc = {
  store: LocalStore<any, any, any>;
  clients: Set<MessagePort>;
};

const LIVE_DOC_CACHE: Record<string, LiveDoc> = {};

function notifyAll(doc: LiveDoc, e: SyncEvent<any, any, any>) {
  doc.clients.forEach((client) => {
    try {
      client.postMessage(e);
    } catch (e) {
      console.error('error sending message, removing client', e);
      doc.clients.delete(client);
    }
  });
}

declare let onconnect: (e: MessageEvent) => void;

onconnect = function (e: MessageEvent) {
  let port = e.ports[0];
  let doc: LiveDoc | undefined;

  port.onmessage = function (e: any) {
    const type = e.data.type;

    switch (type) {
      case 'init':
        if (doc) {
          port.postMessage({
            type: 'error',
            code: 'bad-request',
            message: 'already initialized',
            fatal: false,
          });
          return;
        }
        const { docId, userId } = e.data;
        if (!doc) {
          if (!LIVE_DOC_CACHE[docId]) {
            LIVE_DOC_CACHE[docId] = {
              store: createIndexedDbBackendFactory(docId, {
                getRemote: (userId, lastSyncId, onEvent) =>
                  new WebsocketRemote(
                    { userId, readonly: false },
                    lastSyncId,
                    onEvent,
                    `ws://localhost:4444/${encodeURIComponent(docId)}`,
                  ),
                localIdGenerator: randomId,
                remoteId: 'localhost',
              })(userId, clientId, (e: SyncEvent<any, any, any>) => {
                notifyAll(doc!, e);
              }),
              clients: new Set(),
            };
          }
          doc = LIVE_DOC_CACHE[docId];
          doc.clients.add(port);
        }
        return;
      case 'commits':
        if (!doc) {
          port.postMessage({
            type: 'error',
            code: 'bad-request',
            message: 'not initialized',
            fatal: true,
          });
          return;
        }
        const { commits } = e.data;
        doc.store.update(commits, undefined);
        notifyAll(doc, e.data);
    }
  };
};
