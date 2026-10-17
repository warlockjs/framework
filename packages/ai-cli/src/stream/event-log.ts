/**
 * An append-only event log that any number of async iterators can read.
 * Each iterator starts at the first event and ends once the log is closed
 * and drained, so a late consumer still sees the whole session.
 */
export class EventLog<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private closed = false;
  private waiters: Array<() => void> = [];

  public push(item: T): void {
    if (this.closed) {
      return;
    }

    this.items.push(item);
    this.wake();
  }

  public close(): void {
    this.closed = true;
    this.wake();
  }

  public get size(): number {
    return this.items.length;
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    let index = 0;

    return {
      next: async (): Promise<IteratorResult<T>> => {
        while (index >= this.items.length && !this.closed) {
          await new Promise<void>((resolve) => this.waiters.push(resolve));
        }

        if (index < this.items.length) {
          const value = this.items[index] as T;

          index += 1;

          return { value, done: false };
        }

        return { value: undefined, done: true };
      },
    };
  }

  private wake(): void {
    const waiters = this.waiters;

    this.waiters = [];

    for (const waiter of waiters) {
      waiter();
    }
  }
}
