import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The stores of every context active in one async scope, keyed by each
 * context's slot.
 */
type ContextFrame = ReadonlyMap<ContextSlot<any>, unknown>;

/**
 * The one `AsyncLocalStorage` behind every context. Each enabled
 * `AsyncLocalStorage` adds work to every promise and async resource the
 * process creates, so all contexts share this one and keep their stores in
 * a per-scope frame.
 *
 * A frame is never changed once entered: `run()` and `enterWith()` copy it
 * and replace one slot, so a scope never sees a change made in another one.
 */
const sharedStorage = new AsyncLocalStorage<ContextFrame>();

/**
 * The store access a context needs, with the same meaning as on
 * `AsyncLocalStorage` (`run`, `enterWith`, `getStore`), backed by the shared
 * storage. One slot per context instance.
 */
export interface ContextStorage<TStore> {
  /**
   * Run `callback` with `store` as this context's store; every other context
   * keeps its current store.
   */
  run<R>(store: TStore, callback: () => R): R;
  /**
   * Make `store` this context's store for the rest of the current execution
   * and the async work it starts.
   */
  enterWith(store: TStore): void;
  /**
   * This context's store in the current scope, or `undefined`.
   */
  getStore(): TStore | undefined;
}

/**
 * One context's place in the shared frame.
 *
 * @internal Created by `Context`; used by `ContextManager.runAll()` to enter
 * several contexts with a single run.
 */
export class ContextSlot<TStore> implements ContextStorage<TStore> {
  public run<R>(store: TStore, callback: () => R): R {
    return sharedStorage.run(withSlots([[this, store]]), callback);
  }

  public enterWith(store: TStore): void {
    sharedStorage.enterWith(withSlots([[this, store]]));
  }

  public getStore(): TStore | undefined {
    return sharedStorage.getStore()?.get(this) as TStore | undefined;
  }
}

/**
 * Run `callback` with several slots set at once: one shared-storage run,
 * however many contexts.
 *
 * @internal
 */
export function runWithSlots<R>(
  entries: ReadonlyArray<readonly [ContextSlot<any>, unknown]>,
  callback: () => R,
): R {
  return sharedStorage.run(withSlots(entries), callback);
}

/**
 * A copy of the current frame with the given slots replaced.
 */
function withSlots(entries: ReadonlyArray<readonly [ContextSlot<any>, unknown]>): ContextFrame {
  const frame = new Map(sharedStorage.getStore());

  for (const [slot, store] of entries) {
    frame.set(slot, store);
  }

  return frame;
}
