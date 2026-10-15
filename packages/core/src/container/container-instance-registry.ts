/**
 * A single loaded copy of the container module, as seen by
 * {@link registerContainerInstance}.
 */
export type ContainerInstanceRecord = {
  /**
   * Generated once per module evaluation — never derived from anything a
   * duplicate evaluation could coincidentally share.
   */
  id: string;
  /**
   * `import.meta.url` of this evaluation, when the runtime exposes it
   * cheaply. Omitted rather than guessed when unavailable.
   */
  moduleUrl?: string;
};

/**
 * `globalThis` key the registry is stored under. A `Symbol.for` registry
 * key (not a module-scope variable) is required because the whole point of
 * this file is that it gets evaluated more than once per process — Vite's
 * SSR module runner and Node's ESM loader each hold their own copy of
 * `@warlock.js/core` in the monorepo dev path, and `globalThis` is the only
 * object both evaluations actually share.
 */
const registryKey = Symbol.for("warlock.js/core/container-instance-registry");

type GlobalWithContainerRegistry = typeof globalThis & {
  [registryKey]?: ContainerInstanceRecord[];
};

function getRegistry(): ContainerInstanceRecord[] {
  const globalWithRegistry = globalThis as GlobalWithContainerRegistry;

  if (!globalWithRegistry[registryKey]) {
    globalWithRegistry[registryKey] = [];
  }

  return globalWithRegistry[registryKey];
}

/**
 * Registers this module evaluation as a live container instance.
 *
 * Called once at module load, and only ever appends — it never reads back
 * what it just wrote to decide anything, so it cannot itself judge whether
 * a duplicate exists. That judgment happens later, and only on the
 * container's miss/throw path (see `getRegisteredContainerInstanceCount`
 * usage in `index.ts`), specifically so re-evaluation under a test runner's
 * module reset is never mistaken for duplication at load time.
 */
export function registerContainerInstance(): void {
  const record: ContainerInstanceRecord = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };

  if (typeof import.meta !== "undefined" && import.meta.url) {
    record.moduleUrl = import.meta.url;
  }

  getRegistry().push(record);
}

/**
 * All container instances registered on this process/runtime so far.
 */
export function getRegisteredContainerInstances(): readonly ContainerInstanceRecord[] {
  return getRegistry();
}

/**
 * Clears the registry. Test-only: lets a spec simulate a second loaded
 * instance, or reset back to the innocent single-instance case, without
 * actually loading a second copy of the module.
 */
export function resetContainerInstanceRegistryForTests(): void {
  getRegistry().length = 0;
}
