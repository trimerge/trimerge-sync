const channels = new Map<string, MemoryBroadcastChannel<any>[]>();
const leaders = new Map<
  string,
  {
    current: MemoryBroadcastChannel<any>;
    awaiting: MemoryBroadcastChannel<any>[];
  }
>();

export function resetAll() {
  channels.clear();
  leaders.clear();
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
  private resolveLeader?: () => void;
  private rejectLeader?: (error: Error) => void;

  constructor(
    private readonly channel: string,
    private readonly onEvent: (value: T) => void,
  ) {
    this.array = channels.get(channel) ?? [];
    if (this.array.length === 0) {
      channels.set(channel, this.array);
    }
    this.array.push(this);
  }

  awaitLeadership(): Promise<void> {
    const leader = leaders.get(this.channel);
    if (leader) {
      return new Promise((resolve, reject) => {
        this.resolveLeader = resolve;
        this.rejectLeader = reject;
        leader.awaiting.push(this);
      });
    }
    leaders.set(this.channel, {
      current: this,
      awaiting: [],
    });
    return Promise.resolve();
  }

  async postMessage(value: T): Promise<void> {
    if (this.closed) {
      throw new Error('already closed');
    }
    for await (const channel of this.array) {
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
    if (this.rejectLeader) {
      this.rejectLeader(new Error('closed'));
      this.rejectLeader = undefined;
    }
    this.resolveLeader = undefined;
    const leader = leaders.get(this.channel);
    if (!leader) {
      return;
    }
    removeItem(leader.awaiting, this);
    if (leader.current === this) {
      const nextLeader = leader.awaiting.shift();
      if (nextLeader) {
        if (nextLeader.resolveLeader) {
          leader.current = nextLeader;
          nextLeader.resolveLeader();
          nextLeader.resolveLeader = undefined;
        }
        nextLeader.rejectLeader = undefined;
      } else {
        // No more leaders
        leaders.delete(this.channel);
      }
    }
  }
}
