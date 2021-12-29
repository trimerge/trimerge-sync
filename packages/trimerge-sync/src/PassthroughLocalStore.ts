import { Commit, LocalStore, Remote } from './types';

// this doesn't actually store it just forwards it along to the remote.
export class PassthroughLocalStore<EditMetadata, Delta, Presence>
  implements LocalStore<EditMetadata, Delta, Presence>
{
  constructor(
    private readonly docId: string,
    private readonly userId: string,
    private readonly clientId: string,
    private readonly remote: Remote<EditMetadata, Delta, Presence>,
  ) {
    // TODO(matt): whose responsibility is it to send the init?
    // websocketremote seems to send the init message.

    // Perhaps, there are some transport-specific message types?
    this.remote.send({
      type: 'init',
      version: 1,
      localStoreId: 'blah-blah-blah',
      lastSyncCursor: undefined,
      auth: undefined,
      docId,
      userId,
    });
  }

  update(commits: Commit<EditMetadata, Delta>[]): void {
    this.remote.send({
      type: 'commits',
      commits: commits,
    });
  }

  shutdown(): void | Promise<void> {
    // noop;
  }

  readonly isRemoteLeader = false;
}
