import invariant from 'invariant';
import { Remote } from '../types';
import { MockLocalStore } from './MockLocalStore';

export class MockRemote<CommitMetadata = any, Delta = any, Presence = any>
  extends MockLocalStore<CommitMetadata, Delta, Presence>
  implements Remote<CommitMetadata, Delta, Presence>
{
  private _active = false;

  set active(active: boolean) {
    this._active = active;
    if (active) {
        this.emit({ type: 'remote-state', save: 'ready', read: 'ready', connect: 'online' });
    } else {
        this.emit({ type: 'remote-state', save: 'ready', read: 'offline', connect: 'offline' });
    }
  }

  get active() {
    return this._active;
  }

  private connectedResolve: (() => void) | undefined;

  send(): void {
    invariant(this.active, 'send() called on inactive remote');
    return;
  }
  connect(): void | Promise<void> {
    if (this.connectedResolve) {
      this.connectedResolve();
      this.connectedResolve = undefined;
    }
    this.active = true;
  }
  disconnect(): void | Promise<void> {
    this.active = false;
  }

  get connected(): Promise<void> {
    if (this.active) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.connectedResolve = resolve;
    });
  }

  shutdown() {
    this.active = false;
    super.shutdown();
  }
}
