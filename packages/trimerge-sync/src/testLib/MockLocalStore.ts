import invariant from 'invariant';
import {
  ClientPresenceRef,
  Commit,
  LocalStore,
  OnStoreEventFn,
  SyncEvent,
} from '../types';

/** Simple LocalStore implementation that allows you simulate a local store emitting events to TrimergeClient. */
export class MockLocalStore<CommitMetadata = any, Delta = any, Presence = any>
  implements LocalStore<CommitMetadata, Delta, Presence>
{
  configureLogger(): void {
    /* no-op */
  }

  private onEvent: OnStoreEventFn<CommitMetadata, Delta, Presence> | undefined;
  isRemoteLeader = false;
  private listenedResolve: (() => void) | undefined;
  isShutdown = false;

  async update(
    _commits: readonly Commit<CommitMetadata, Delta>[],
    _presence: ClientPresenceRef<Presence> | undefined,
  ): Promise<void> {
    return;
  }

  listen(onEvent: OnStoreEventFn<CommitMetadata, Delta, Presence>): void {
    invariant(!this.onEvent, 'listen() called twice');
    invariant(!this.isShutdown, 'listen() called after shutdown()');

    if (this.listenedResolve) {
      this.listenedResolve();
      this.listenedResolve = undefined;
    }
    this.onEvent = onEvent;
  }

  shutdown() {
    invariant(!this.isShutdown, 'shutdown() called twice');
    this.onEvent = undefined;
  }

  emit(
    event: SyncEvent<CommitMetadata, Delta, Presence>,
    remoteOrigin?: boolean,
  ) {
    if (this.onEvent) {
      this.onEvent(event, Boolean(remoteOrigin));
    }
  }

  get listened(): Promise<void> {
    if (this.onEvent) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.listenedResolve = resolve;
    });
  }
}
