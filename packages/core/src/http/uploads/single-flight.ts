/**
 * Runs a task once per key at a time.
 *
 * A caller that arrives while the task for its key is still running gets the
 * same promise instead of starting a second run, so N concurrent cache misses
 * for one derivative generate it once. The entry is dropped when the task
 * settles, success or failure, so a failed run is retried by the next request.
 */
export class SingleFlight<T> {
  protected readonly inflight = new Map<string, Promise<T>>();

  /**
   * Run `task` for `key`, or join the run already in flight
   */
  public run(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);

    if (existing) return existing;

    const promise = (async () => {
      try {
        return await task();
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);

    return promise;
  }

  /**
   * Number of keys currently in flight
   */
  public get size(): number {
    return this.inflight.size;
  }
}
