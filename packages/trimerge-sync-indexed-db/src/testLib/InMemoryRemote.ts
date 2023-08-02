import type { Commit, OnRemoteEventFn, Remote, SyncEvent } from 'trimerge-sync';
import { addInvalidRefsToAckEvent, validateCommitOrder } from 'trimerge-sync';

export class InMemoryRemote implements Remote<any, any, any> {
  active = false;
  loggingHandle = 'IN_MEMORY_REMOTE';
  private onEvent: OnRemoteEventFn<any, any, any> | undefined;
  constructor(
    private readonly commits: Map<string, Commit<any, any>> = new Map(),
    private readonly getRemoteMetadata?: (commit: Commit<any, any>) => any,
  ) {}

  emit(event: SyncEvent<any, any, any>): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }

  configureLogger(): void {
    /* No-op */
  }

  connect(): void | Promise<void> {
    this.active = true;
    this.emit({ type: 'remote-state', connect: 'online' });
    this.emit({ type: 'ready' });
  }

  listen(cb: OnRemoteEventFn<any, any, any>): () => void {
    if (this.onEvent) {
      throw new Error('MockRemote only supports one listener');
    }
    this.onEvent = cb;
    return () => {
      this.onEvent = undefined;
    };
  }

  disconnect(): void | Promise<void> {
    this.active = false;
    this.emit({ type: 'remote-state', connect: 'offline', read: 'offline' });
  }

  send(event: SyncEvent<any, any, any>): void {
    // broadcast to other clients
    switch (event.type) {
      case 'commits':
        const { newCommits, invalidRefs } = validateCommitOrder<any, any>(
          event.commits,
        );
        for (const commit of newCommits) {
          if (!this.commits.has(commit.ref)) {
            this.commits.set(commit.ref, commit);
          }
        }
        this.emit(
          addInvalidRefsToAckEvent(
            {
              type: 'ack',
              acks: newCommits.map(({ ref }) => {
                return {
                  ref,
                  metadata: this.getRemoteMetadata?.(
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this.commits.get(ref)!,
                  ),
                };
              }),
              syncId: 'foo',
            },
            invalidRefs,
          ),
        );
    }
  }

  shutdown(): void {
    // noop
  }
}
export function getInMemoryRemoteWithMap(
  commits?: Map<string, Commit<any, any>>,
  getRemoteMetadata?: (commit: Commit<any, any>) => any,
): Remote<any, any, any> {
  return new InMemoryRemote(commits, getRemoteMetadata);
}
