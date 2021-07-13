/**
 * Ensures only one promise is being called at a time.
 *
 * Used for testing
 */
export class PromiseQueue {
  private promise: Promise<unknown> = Promise.resolve();
  add<T>(exec: () => Promise<T>): Promise<T> {
    const typedPromise = this.promise.then(exec);
    this.promise = typedPromise.catch(() => undefined);
    return typedPromise;
  }
}
