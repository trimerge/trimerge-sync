const channels = new Map<string, MemoryBroadcastChannel<any>[]>();

export function resetAll() {
  channels.clear();
}

function removeItem<T>(array: T[], item: T): boolean {
  const index = array.indexOf(item);
  if (index < 0) {
    return false;
  }
  array.splice(index, 1);
  return true;
}

export class MemoryBroadcastChannel<T> {
  private closed = false;
  private readonly array: MemoryBroadcastChannel<T>[];

  constructor(
    private readonly channel: string,
    public onEvent: (value: T) => void,
  ) {
    this.array = channels.get(channel) ?? [];
    if (this.array.length === 0) {
      channels.set(channel, this.array);
    }
    this.array.push(this);
  }

  async postMessage(value: T): Promise<void> {
    if (this.closed) {
      throw new Error('already closed');
    }
    for await (const channel of Array.from(this.array)) {
      if (channel !== this) {
        channel.onEvent(value);
      }
    }
  }
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    removeItem(this.array, this);
  }
}
