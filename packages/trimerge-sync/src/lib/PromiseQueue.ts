/**
 * Ensures that provided promises are called in the order they were received, one at a time.
 */
export class PromiseQueue {
  private promise: Promise<unknown> = Promise.resolve();
  private running = true;
  add<T>(exec: () => Promise<T>): Promise<T> {
    if (!this.running) {
      return Promise.reject(new Error('PromiseQueue is closed'));
    }
    const typedPromise = this.promise.then(exec);
    this.promise = typedPromise.catch(() => undefined);
    return typedPromise;
  }

  async shutdown(): Promise<void> {
    this.running = false;
    return await this.promise.then();
  }
}
