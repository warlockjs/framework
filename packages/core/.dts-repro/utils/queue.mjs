//#region ../../@warlock.js/core/src/utils/queue.ts
/**
* A utility class for managing a queue of operations.
* Allows enqueuing values and executing a function when the queue reaches a certain size or after a specified interval.
* Supports both parallel and sequential execution of the queued operations.
*/
var Queue = class {
	/**
	* Constructs a new Queue instance.
	* @param executeFn - The function to execute with the items in the queue.
	* @param maxSize - The maximum number of items before the queue is executed.
	* @param executeEvery - The time in milliseconds after which the queue is executed if not already triggered.
	* @param executeInParallel - Whether to execute the function in parallel or sequentially.
	* @param batchSize - The number of items to process in each batch.
	*/
	constructor(executeFn, executeInParallel = true, executeEvery = 5e3, batchSize, maxSize) {
		this.items = [];
		this.timer = null;
		this.isExecuting = false;
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
	enqueue(item) {
		this.items.push(item);
		if (this.maxSize && this.items.length >= this.maxSize) this.execute();
		if (!this.timer) this.startTimer();
	}
	/**
	* Starts a timer to execute the queue after the specified interval.
	*/
	startTimer() {
		this.timer = setInterval(() => {
			if (this.items.length > 0) this.execute();
		}, this.interval);
	}
	/**
	* Executes the function with the current items in the queue.
	* Processes items in batches and resets the timer.
	*/
	async execute() {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.isExecuting = true;
		if (this.batchSize) {
			const itemsToProcess = this.items.splice(0, this.batchSize);
			if (this.executeInParallel) await Promise.all(itemsToProcess.map((item) => this.executeFn([item])));
			else for (const item of itemsToProcess) await this.executeFn([item]);
		}
		this.isExecuting = false;
	}
};
//#endregion
export { Queue };

//# sourceMappingURL=queue.mjs.map