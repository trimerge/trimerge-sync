// shared worker remote is responsible for liasing with the shared worker

import { OnEventFn, Remote, SyncEvent } from 'trimerge-sync';
import PQueue from 'p-queue';

const tag = 'LIVE-COLLAB-SHARED-WORKER';

function logStdout(...args: unknown[]) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${tag}]`, ...args);
  }
}

function logStderr(...args: unknown[]) {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[${tag}]`, ...args);
  }
}

export function createSharedWorkerRemote<EditMetadata, Delta, Presence>(
  onEvent: OnEventFn<EditMetadata, Delta, Presence>,
  worker: SharedWorker,
): SharedWorkerRemote<EditMetadata, Delta, Presence> {
  return new SharedWorkerRemote(onEvent, worker);
}

export class SharedWorkerRemote<EditMetadata, Delta, Presence>
  implements Remote<EditMetadata, Delta, Presence>
{
  private readonly queue = new PQueue({ concurrency: 1 });

  constructor(
    private readonly onEvent: OnEventFn<EditMetadata, Delta, Presence>,
    private readonly sharedWorker: SharedWorker,
  ) {
    logStdout('creating shared worker remote');
  }

  send(event: SyncEvent<EditMetadata, Delta, Presence>): void {
    logStdout('receieved event to send', event);
    this.sharedWorker.port.postMessage(event);
    switch (event.type) {
      case 'commits':
        this.onEvent({ type: 'remote-state', save: 'saving' });
        // TODO: postmessage to shared worker.
        break;
      default:
        // commits is the only event that we can do anything about.
        logStdout('skipping sending event:', event);
    }
  }

  shutdown(): void | Promise<void> {
    this.onEvent({
      type: 'remote-state',
      connect: 'offline',
      read: 'offline',
    });
  }
}
