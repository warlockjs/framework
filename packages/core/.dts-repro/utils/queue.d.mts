//#region ../../@warlock.js/core/src/utils/queue.d.ts
/**
 * A utility class for managing a queue of operations.
 * Allows enqueuing values and executing a function when the queue reaches a certain size or after a specified interval.
 * Supports both parallel and sequential execution of the queued operations.
 */
declare class Queue<T> {
  /** The items currently in the queue. */
  private items;
  /** The maximum size of the queue before triggering execution. */
  private readonly maxSize?;
  /** The interval in milliseconds after which the queue will be executed if not already triggered by size. */
  private readonly interval;
  /** The function to execute with the items in the queue. */
  private readonly executeFn;
  /** Timer for managing the interval-based execution. */
  private timer;
  /** Flag to determine if execution should be parallel or sequential. */
  private readonly executeInParallel;
  /** The batch size for processing items. */
  private readonly batchSize;
  /** Whether the current queue is busy executing */
  private isExecuting;
  /**
   * Constructs a new Queue instance.
   * @param executeFn - The function to execute with the items in the queue.
   * @param maxSize - The maximum number of items before the queue is executed.
   * @param executeEvery - The time in milliseconds after which the queue is executed if not already triggered.
   * @param executeInParallel - Whether to execute the function in parallel or sequentially.
   * @param batchSize - The number of items to process in each batch.
   */
  constructor(executeFn: (items: T[]) => Promise<void>, executeInParallel: boolean | undefined, executeEvery: number | undefined, batchSize: number, maxSize?: number);
  /**
   * Adds an item to the queue.
   * Triggers execution if the queue reaches the maximum size.
   * Starts a timer if not already running.
   * @param item - The item to add to the queue.
   */
  enqueue(item: T): void;
  /**
   * Starts a timer to execute the queue after the specified interval.
   */
  private startTimer;
  /**
   * Executes the function with the current items in the queue.
   * Processes items in batches and resets the timer.
   */
  private execute;
}
//#endregion
export { Queue };
//# sourceMappingURL=queue.d.mts.map