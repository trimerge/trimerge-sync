import { removeItem } from './Arrays';

const ALL_CHANNELS = new Map<string, MemoryBroadcastChannel<any>[]>();

export function resetAll() {
  ALL_CHANNELS.clear();
}

function getChannelsArray(name: string) {
  let channels = ALL_CHANNELS.get(name);
  if (!channels) {
    channels = [];
    ALL_CHANNELS.set(name, channels);
  }
  return channels;
}

export function setChannelsPaused(paused: boolean) {
  for (const channels of ALL_CHANNELS.values()) {
    for (const channel of channels) {
      channel.paused = paused;
    }
  }
}

export class MemoryBroadcastChannel<T> {
  private _closed = false;
  private _paused = false;
  private readonly _channels: MemoryBroadcastChannel<T>[];
  private _postMessageQueue: T[] = [];
  private _onMessageQueue: T[] = [];

  constructor(
    private readonly channelName: string,
    private readonly _onMessage: (value: T) => void,
  ) {
    this._channels = getChannelsArray(channelName);
    this._channels.push(this);
  }

  set paused(paused: boolean) {
    this._paused = paused;
    if (!paused && !this._closed) {
      // Send queued events
      for (const message of this._postMessageQueue) {
        void this.postMessage(message);
      }
      this._postMessageQueue = [];
      for (const message of this._onMessageQueue) {
        this._onMessage(message);
      }
      this._onMessageQueue = [];
    }
  }

  onMessage(message: T): void {
    if (this._paused) {
      this._onMessageQueue.push(message);
      return;
    }
    this._onMessage(message);
  }

  async postMessage(message: T): Promise<void> {
    if (this._closed) {
      throw new Error('already closed');
    }
    if (this._paused) {
      this._postMessageQueue.push(message);
      return;
    }
    for await (const channel of Array.from(this._channels)) {
      if (channel !== this) {
        channel.onMessage(message);
      }
    }
  }
  close(): void {
    if (this._closed) {
      return;
    }
    this._closed = true;
    removeItem(this._channels, this);
  }
}
