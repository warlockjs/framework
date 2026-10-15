import { AsyncLocalStorage } from "async_hooks";

/**
 * Keys that reach `Object.prototype` instead of the store when assigned.
 *
 * `Object.assign(store, { __proto__: {...} })` does not create a property — it
 * invokes the inherited `__proto__` setter and reparents the store, which for a
 * shared context store means every later property lookup in the process can
 * resolve through attacker-supplied data. `constructor` / `prototype` are the
 * neighbouring rungs of the same ladder.
 */
const DANGEROUS_KEYS = ["__proto__", "constructor", "prototype"] as const;

/**
 * Drop prototype-poisoning keys from a merge payload.
 *
 * Contexts are frequently fed request-shaped data (`context.update(req.body)`,
 * `context.set(key, value)` with a caller-supplied key), so the merge path is
 * treated as an untrusted boundary: dangerous keys are dropped rather than
 * throwing, since a request that trips this must not be able to take the
 * process down, and the store simply never carries them.
 *
 * The common case allocates nothing — a copy is made only when a dangerous key
 * is actually present. The copy is built by spread (which defines properties
 * rather than assigning them, so it cannot trigger the setter itself) and
 * preserves symbol keys, which `Object.assign` would have copied.
 */
function withoutDangerousKeys<T>(updates: T): T {
  if (!updates || typeof updates !== "object") return updates;

  const hasDangerousKey = DANGEROUS_KEYS.some(key =>
    Object.prototype.hasOwnProperty.call(updates, key),
  );

  if (!hasDangerousKey) return updates;

  const safe: Record<string, any> = { ...(updates as Record<string, any>) };

  for (const key of DANGEROUS_KEYS) {
    delete safe[key];
  }

  return safe as T;
}

/**
 * Base class for all AsyncLocalStorage-based contexts
 *
 * Provides a consistent API for managing context across async operations.
 * All framework contexts (request, storage, database) extend this class.
 *
 * @template TStore - The type of data stored in context
 *
 * @example
 * ```typescript
 * interface MyContextStore {
 *   userId: string;
 *   tenant: string;
 * }
 *
 * class MyContext extends Context<MyContextStore> {}
 * const myContext = new MyContext();
 *
 * // Use it
 * await myContext.run({ userId: '123', tenant: 'acme' }, async () => {
 *   const userId = myContext.get('userId'); // '123'
 * });
 * ```
 */
export abstract class Context<TStore extends Record<string, any>> {
  protected readonly storage: AsyncLocalStorage<TStore> = new AsyncLocalStorage<TStore>();

  /**
   * Run a callback within a new context
   *
   * Creates a new async context with the provided store data.
   * All operations within the callback will have access to this context.
   *
   * @param store - Initial context data
   * @param callback - Async function to execute
   * @returns Result of the callback
   */
  public run<T>(store: TStore, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(store, callback);
  }

  /**
   * Enter a new context without a callback
   *
   * Useful for middleware where you want to set context for the rest of the request.
   * Unlike `run()`, this doesn't require a callback.
   *
   * @param store - Context data to set
   */
  public enter(store: TStore): void {
    this.storage.enterWith(store);
  }

  /**
   * Update the current context
   *
   * Merges new data into existing context, or enters new context if none exists.
   *
   * Keys named `__proto__`, `constructor`, or `prototype` are dropped: the
   * merge target is a store shared by everything running in this async chain,
   * so letting those through would let one caller's payload change property
   * resolution for the whole process. Passing unvalidated input here is still
   * discouraged — this guard closes the prototype vector, not the "an attacker
   * chose what your context says" one.
   *
   * @param updates - Partial context data to merge
   */
  public update(updates: Partial<TStore>): void {
    const safeUpdates = withoutDangerousKeys(updates);

    const current = this.storage.getStore();

    if (current) {
      Object.assign(current, safeUpdates);
    } else {
      this.enter(safeUpdates as TStore);
    }
  }

  /**
   * Get the current context store
   *
   * @returns Current context or undefined if not in context
   */
  public getStore(): TStore | undefined {
    return this.storage.getStore();
  }

  /**
   * Get a specific value from context
   *
   * @param key - Key to retrieve
   * @returns Value or undefined
   */
  public get<K extends keyof TStore>(key: K): TStore[K] | undefined {
    return this.storage.getStore()?.[key];
  }

  /**
   * Set a specific value in context
   *
   * Goes through `update()`, so a caller-supplied `key` of `__proto__` /
   * `constructor` / `prototype` is dropped rather than reparenting the store.
   *
   * @param key - Key to set
   * @param value - Value to store
   */
  public set<K extends keyof TStore>(key: K, value: TStore[K]): void {
    this.update({ [key]: value } as any);
  }

  /**
   * Clear the context
   */
  public clear(): void {
    this.storage.enterWith({} as TStore);
  }

  /**
   * Check if currently in a context
   */
  public hasContext(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /**
   * Build the initial store for this context
   *
   * Override this method to provide custom initialization logic.
   * Called by ContextManager.buildStores() for each registered context.
   *
   * @param payload - Generic payload (e.g., { request, response } for HTTP contexts)
   * @returns Initial store data
   */
  public abstract buildStore(payload?: Record<string, any>): TStore;
}
