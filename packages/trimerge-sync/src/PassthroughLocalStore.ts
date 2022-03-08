import { Commit, LocalStore, Remote } from './types';

// this doesn't actually store it just forwards it along to the remote.
export class PassthroughLocalStore<EditMetadata, Delta, Presence>
  implements LocalStore<EditMetadata, Delta, Presence>
{
  constructor(
    protected readonly userId: string,
    protected readonly clientId: string,
    private readonly remote: Remote<EditMetadata, Delta, Presence>,
  ) {}

  update(commits: Commit<EditMetadata, Delta>[]): void {
    console.log('PassthroughLocalStore.update', commits);
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
