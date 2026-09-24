/**
 * A utility class for managing a queue of operations.
 * Allows enqueuing values and executing a function when the queue reaches a certain size or after a specified interval.
 * Supports both parallel and sequential execution of the queued operations.
 */
export class Queue<T> {
  /** The items currently in the queue. */
  private items: T[] = [];

  /** The maximum size of the queue before triggering execution. */
  private readonly maxSize?: number;

  /** The interval in milliseconds after which the queue will be executed if not already triggered by size. */
  private readonly interval: number;

  /** The function to execute with the items in the queue. */
  private readonly executeFn: (items: T[]) => Promise<void>;

  /** Timer for managing the interval-based execution. */
  private timer: NodeJS.Timeout | null = null;

  /** Flag to determine if execution should be parallel or sequential. */
  private readonly executeInParallel: boolean;

  /** The batch size for processing items. */
  private readonly batchSize?: number;

  /** Called when the execute function rejects. */
  private readonly onError: (error: unknown) => void;

  /** Whether the current queue is busy executing */
  private isExecuting = false;

  /**
   * Constructs a new Queue instance.
   * @param executeFn - The function to execute with the items in the queue.
   * @param maxSize - The maximum number of items before the queue is executed.
   * @param executeEvery - The time in milliseconds after which the queue is executed if not already triggered.
   * @param executeInParallel - Whether to execute the function in parallel or sequentially.
   * @param batchSize - The number of items to process in each batch.
   */
  public constructor(
    executeFn: (items: T[]) => Promise<void>,
    executeInParallel: boolean = true,
    executeEvery: number = 5000,
    batchSize?: number,
    maxSize?: number,
    onError: (error: unknown) => void = (error) => console.error("Queue execution failed", error),
  ) {
    this.onError = onError;
    this.executeFn = executeFn;
    this.maxSize = maxSize;
    this.interval = executeEvery;
    this.executeInParallel = executeInParallel;
    this.batchSize = batchSize;
  }

  /**
   * Adds an item to the queue.
   * Triggers execution if the queue reaches the maximum size.
   * Starts a timer if not already running.
   * @param item - The item to add to the queue.
   */
  public enqueue(item: T): void {
    this.items.push(item);
    if (this.maxSize && this.items.length >= this.maxSize) {
      void this.execute();
    }

    if (!this.timer && !this.isExecuting) {
      this.startTimer();
    }
  }

  /**
   * Starts a timer to execute the queue after the specified interval.
   */
  private startTimer(): void {
    this.timer = setInterval(() => {
      if (this.items.length > 0) {
        void this.execute();
      }
    }, this.interval);
    this.timer.unref?.();
  }

  /**
   * Executes the function with the queued items until the queue is drained.
   * Rejections from the execute function are passed to `onError`.
   */
  private async execute(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // the running drain loop will pick up newly enqueued items
    if (this.isExecuting) return;

    this.isExecuting = true;

    try {
      while (this.items.length > 0) {
        // Without a batch size, all items go in a single call
        const batch = this.items.splice(0, this.batchSize || this.items.length);

        try {
          if (!this.batchSize) {
            await this.executeFn(batch);
          } else if (this.executeInParallel) {
            await Promise.all(batch.map((item) => this.executeFn([item])));
          } else {
            for (const item of batch) {
              await this.executeFn([item]);
            }
          }
        } catch (error) {
          this.onError(error);
        }
      }
    } finally {
      this.isExecuting = false;
    }
  }
}
