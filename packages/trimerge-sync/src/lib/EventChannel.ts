import { SyncEvent } from '../types';

export type BroadcastEvent<CommitMetadata, Delta, Presence> = {
  event: SyncEvent<CommitMetadata, Delta, Presence>;
  senderClientId?: string;
  remoteOrigin: boolean;
};

export type EventChannel<CommitMetadata, Delta, Presence> = {
  onEvent(
    cb: (ev: BroadcastEvent<CommitMetadata, Delta, Presence>) => void,
  ): void;
  sendEvent(ev: BroadcastEvent<CommitMetadata, Delta, Presence>): void;
  shutdown(): void | Promise<void>;
};
