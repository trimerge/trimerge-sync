export type OnChangeFn<T, E> = (state: T, event: E) => void;

export class SubscriberList<T, E> {
  private readonly map = new Map<OnChangeFn<T, E>, T>();

  constructor(
    private readonly get: () => T,
    private readonly equalFn: (a: T, b: T) => boolean = (a, b) => a === b,
  ) {}

  subscribe(onChange: OnChangeFn<T, E>, event: E) {
    const state = this.get();
    this.map.set(onChange, state);
    onChange(state, event);
    return () => {
      this.map.delete(onChange);
    };
  }

  emitChange(event: E) {
    const state = this.get();
    const { equalFn: eq, map } = this;
    for (const [subscriber, lastState] of map.entries()) {
      if (!eq(state, lastState)) {
        subscriber(state, event);
        map.set(subscriber, state);
      }
    }
  }
}
