/**
 * Thrown by `container.getOrFail(key)` when `key` is not registered.
 *
 * On a single-instance runtime this is an ordinary "you forgot to register
 * this" error, worded exactly as before. When more than one copy of
 * `@warlock.js/core`'s container module is loaded in the same process —
 * confirmed via `container-instance-registry.ts`, which every loaded copy
 * registers itself into through `globalThis` — the miss may instead mean
 * the value WAS set, just on the other instance. That is a dev/
 * source-consumption condition only: a published install resolves to a
 * single `node_modules` copy, so a single instance is always registered
 * there.
 */
export class ContainerKeyMissingError extends Error {
  public constructor(key: string, instanceCount: number) {
    super(ContainerKeyMissingError.buildMessage(key, instanceCount));
    this.name = "ContainerKeyMissingError";
  }

  private static buildMessage(key: string, instanceCount: number): string {
    if (instanceCount <= 1) {
      return `Container key "${key}" is not registered.`;
    }

    return (
      `Container key "${key}" is not registered on this instance, but ${instanceCount} ` +
      `separate copies of @warlock.js/core's container are currently loaded in this ` +
      `process. The value may have been set on one of the other instances, not this ` +
      `one — this happens when a source-consumption dev path (e.g. Vite's SSR module ` +
      `runner alongside Node's ESM loader) evaluates the package more than once. A ` +
      `published install resolves to a single copy and is not affected.`
    );
  }
}
