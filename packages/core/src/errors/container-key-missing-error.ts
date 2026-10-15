/**
 * Maximum number of registered keys named in a {@link ContainerKeyMissingError}
 * message. Bounded so a container with hundreds of registrations doesn't
 * turn a diagnostic message into a wall of text.
 */
const MAX_LISTED_KEYS = 20;

/**
 * Thrown by `container.get(key)` when `key` is not registered.
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
  public constructor(key: string, instanceCount: number, registeredKeys: readonly string[] = []) {
    super(ContainerKeyMissingError.buildMessage(key, instanceCount, registeredKeys));
    this.name = "ContainerKeyMissingError";
  }

  private static buildMessage(
    key: string,
    instanceCount: number,
    registeredKeys: readonly string[],
  ): string {
    const base =
      instanceCount <= 1
        ? `Container key "${key}" is not registered.`
        : `Container key "${key}" is not registered on this instance, but ${instanceCount} ` +
          `separate copies of @warlock.js/core's container are currently loaded in this ` +
          `process. The value may have been set on one of the other instances, not this ` +
          `one — this happens when a source-consumption dev path (e.g. Vite's SSR module ` +
          `runner alongside Node's ESM loader) evaluates the package more than once. A ` +
          `published install resolves to a single copy and is not affected.`;

    return `${base} ${ContainerKeyMissingError.describeRegisteredKeys(registeredKeys)}`;
  }

  private static describeRegisteredKeys(registeredKeys: readonly string[]): string {
    if (registeredKeys.length === 0) {
      return "No keys are registered.";
    }

    const listed = registeredKeys.slice(0, MAX_LISTED_KEYS);
    const remaining = registeredKeys.length - listed.length;
    const suffix = remaining > 0 ? `, and ${remaining} more` : "";

    return `Registered keys: ${listed.map((registeredKey) => `"${registeredKey}"`).join(", ")}${suffix}.`;
  }
}
