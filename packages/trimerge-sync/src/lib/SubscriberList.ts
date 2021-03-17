export type OnChangeFn<T> = (state: T) => void;

export class SubscriberList<T> {
  private readonly map = new Map<OnChangeFn<T>, T>();

  constructor(
    private readonly get: () => T,
    private readonly equalFn: (a: T, b: T) => boolean = (a, b) => a === b,
  ) {}

  subscribe(onChange: OnChangeFn<T>) {
    const state = this.get();
    this.map.set(onChange, state);
    onChange(state);
    return () => {
      this.map.delete(onChange);
    };
  }

  emitChange() {
    const state = this.get();
    const { equalFn: eq, map } = this;
    for (const [subscriber, lastState] of map.entries()) {
      if (!eq(state, lastState)) {
        subscriber(state);
        map.set(subscriber, state);
      }
    }
  }
}
