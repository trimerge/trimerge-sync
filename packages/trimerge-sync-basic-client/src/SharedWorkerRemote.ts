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

export class SharedWorkerRemote<EditMetadata, Delta, Presence>
  implements Remote<EditMetadata, Delta, Presence>
{
  private readonly queue = new PQueue({ concurrency: 1 });

  constructor(
    private readonly onEvent: OnEventFn<EditMetadata, Delta, Presence>,
    private readonly sharedWorker: SharedWorker,
  ) {
    logStdout('creating shared worker remote');
    sharedWorker.port.onmessage = (e) => {
      logStdout('received message from shared worker', e);
      void this.queue.add(() => this.onEvent(e.data));
    };
  }

  send(event: SyncEvent<EditMetadata, Delta, Presence>): void {
    logStdout('receieved event to send', event);
    this.sharedWorker.port.postMessage(event);
  }

  shutdown(): void | Promise<void> {
    this.onEvent({
      type: 'remote-state',
      connect: 'offline',
      read: 'offline',
    });
  }
}
