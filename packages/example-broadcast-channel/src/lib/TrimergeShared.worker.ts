// this is the code for the singleton live collab worker shared across all
// windows.

import { TrimergeClient } from 'trimerge-sync';
import { WebsocketRemote } from 'trimerge-sync-basic-client';
import { createIndexedDbBackendFactory } from 'trimerge-sync-indexed-db';
import { differ } from '../AppDoc';
import { randomId } from './randomId';

let client: TrimergeClient<any, any, any, any, any>;

console.log('initialize shared worker');

declare let onconnect: (e: MessageEvent) => void;

onconnect = function (e: MessageEvent) {
  var port = e.ports[0];
  console.log('connected', e);

  port.onmessage = function (e: any) {
    console.log('trimerge sync shared worker message', e);
    if (!client) {
      client = new TrimergeClient(
        'blah',
        'blah-blah',
        createIndexedDbBackendFactory('blah-blah-blah', {
          getRemote: (userId, lastSyncId, onEvent) =>
            new WebsocketRemote(
              { userId, readonly: false },
              lastSyncId,
              onEvent,
              `ws://localhost:4444/${encodeURIComponent('blah-blah-blah')}`,
            ),
          localIdGenerator: randomId,
          remoteId: 'localhost',
        }),
        differ,
        100,
      );
    }
    var workerResult = 'Result: ' + e.data[0] * e.data[1];
    port.postMessage(workerResult);
  };
};
