import { StorageError } from "./storage-error";

/**
 * Thrown when an operation needs an optional driver capability that the
 * active driver does not implement (e.g. `putIfAbsent()` on a driver that
 * cannot guarantee an atomic create-if-absent).
 *
 * Callers can probe first (`storage.supportsPutIfAbsent()`) or branch on
 * `instanceof StorageCapabilityError`.
 */
export class StorageCapabilityError extends StorageError {
  /**
   * The missing capability (e.g. "putIfAbsent").
   */
  public readonly capability: string;

  /**
   * Name of the driver that lacks the capability.
   */
  public readonly driverName: string;

  public constructor(capability: string, driverName: string) {
    super(
      `Storage driver "${driverName}" does not support "${capability}". ` +
        `Use a driver that implements it, or check supportsPutIfAbsent() first.`,
      { context: { capability, driver: driverName } },
    );
    this.name = "StorageCapabilityError";
    this.capability = capability;
    this.driverName = driverName;
  }
}
