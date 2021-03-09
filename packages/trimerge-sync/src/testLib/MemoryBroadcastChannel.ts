const channels = new Map<string, MemoryBroadcastChannel<any>[]>();

export class MemoryBroadcastChannel<T> {
  private readonly array: MemoryBroadcastChannel<T>[];
  constructor(channel: string, private readonly onEvent: (value: T) => void) {
    this.array = channels.get(channel) ?? [];
    if (this.array.length === 0) {
      channels.set(channel, this.array);
    }
    this.array.push(this);
  }
  async postMessage(value: T): Promise<void> {
    for await (const channel of this.array) {
      if (channel !== this) {
        channel.onEvent(value);
      }
    }
  }
  close() {
    const index = this.array.indexOf(this);
    if (index >= 0) {
      this.array.splice(index, 1);
    }
  }
}
