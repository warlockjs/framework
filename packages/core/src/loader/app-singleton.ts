/**
 * Process-wide singletons that survive hot reloads and module duplication.
 *
 * A module-level `let` holds one value per evaluation of its file. In
 * `warlock dev` a file can be evaluated more than once in one process: every
 * hot reload creates a new generation while the old one stays in memory (an ES
 * module graph cannot be unloaded), and a module that stays inside the page
 * renderer's Vite graph is a second copy of the same file. A connector that
 * installs a value and a route that reads it can then hold different copies,
 * and the old generation still owns its sockets, timers and file locks.
 *
 * {@link appSingleton} keeps the value on `globalThis` under a registered
 * symbol (`Symbol.for`), so every copy of the module, and every module that
 * names the same key, gets the same value. Production behaves the same way.
 */

const SLOT_PREFIX = "warlock.appSingleton:";

type DisposeFn<T> = (value: T) => void | Promise<void>;

type Slot = {
  value: unknown;
  dispose?: DisposeFn<any>;
};

type SlotStore = Record<symbol, Slot | undefined>;

type ReloadFile = { addCleanup(cleanup: () => void | Promise<void>): void };

export type AppSingletonOptions<T> = {
  /**
   * Releases the value's resources. Runs once, when the singleton is disposed
   * with {@link disposeAppSingleton}, on a full shutdown or restart of the
   * application, and (with `disposeOnReload`) before a hot reload.
   */
  dispose?: DisposeFn<T>;
  /**
   * `warlock dev` only. Dispose the value when the module that is being loaded
   * is reloaded, so the next generation builds a fresh one before the old one
   * keeps holding sockets or locks. Takes effect when `appSingleton` is called
   * while a module is loading (at the top level of a file, or in code that runs
   * from it). Use `onCleanup(() => disposeAppSingleton(key))` for any other
   * call site.
   */
  disposeOnReload?: boolean;
};

function slotOf(key: string): symbol {
  if (typeof key !== "string" || key.trim() === "") {
    throw new TypeError("appSingleton: key must be a non-empty string");
  }

  return Symbol.for(SLOT_PREFIX + key);
}

function store(): SlotStore {
  return globalThis as unknown as SlotStore;
}

/**
 * Get the singleton stored under `key`, creating it on first use.
 *
 * `create` runs once per process (or once per disposal), no matter how many
 * copies of the calling module exist. Namespace and version the key
 * (`my-app.billing.runtime.v1`) and change the version when the stored shape
 * changes, so an old copy never reads a value it does not understand.
 *
 * @example
 * export const getRuntime = () =>
 *   appSingleton("my-app.worker-runtime.v1", () => new WorkerRuntime(), {
 *     dispose: (runtime) => runtime.stop(),
 *   });
 */
export function appSingleton<T>(
  key: string,
  create: () => T,
  options: AppSingletonOptions<T> = {},
): T {
  const symbol = slotOf(key);
  const existing = store()[symbol];

  if (existing) {
    // A later copy of the module may be the one that knows how to dispose.
    if (options.dispose && !existing.dispose) existing.dispose = options.dispose;

    registerReloadDisposal(key, options);

    return existing.value as T;
  }

  const slot: Slot = { value: create(), dispose: options.dispose };
  store()[symbol] = slot;
  registerReloadDisposal(key, options);

  return slot.value as T;
}

function registerReloadDisposal(key: string, options: AppSingletonOptions<any>): void {
  if (!options.disposeOnReload) return;

  const file = (globalThis as { __currentModuleFile?: ReloadFile }).__currentModuleFile;

  file?.addCleanup(() => disposeAppSingleton(key));
}

/**
 * The singleton stored under `key`, or `undefined` when none was created.
 */
export function peekAppSingleton<T = unknown>(key: string): T | undefined {
  return store()[slotOf(key)]?.value as T | undefined;
}

/**
 * Forget the singleton under `key` and run its `dispose`. The next
 * {@link appSingleton} call creates a fresh value. Safe to call twice.
 */
export async function disposeAppSingleton(key: string): Promise<void> {
  const symbol = slotOf(key);
  const slot = store()[symbol];

  if (!slot) return;

  // Forget first: a dispose that throws must not leave a half-closed value.
  delete store()[symbol];

  await slot.dispose?.(slot.value);
}

/**
 * Dispose every app singleton, newest first. The application calls this on
 * shutdown and before a dev restart; one failing `dispose` does not stop the
 * rest, and the first error is rethrown at the end.
 */
export async function disposeAllAppSingletons(): Promise<void> {
  const symbols = Object.getOwnPropertySymbols(globalThis)
    .filter((symbol) => symbol.description?.startsWith(SLOT_PREFIX))
    .reverse();
  const errors: unknown[] = [];

  for (const symbol of symbols) {
    const key = symbol.description!.slice(SLOT_PREFIX.length);

    try {
      await disposeAppSingleton(key);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) throw errors[0];
}
