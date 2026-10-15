import { PortInUseError } from "../http/port-preflight";

/**
 * Marks a startup failure whose cause cannot change because the dev worker
 * tried again — a rejected `Application.onValidateBoot(...)` validator, an
 * unusable configured value, or (via {@link isBootPreconditionError})
 * {@link PortInUseError} itself. Distinct from an ordinary code error or a
 * refused database/cache connection, both of which ARE worth restarting for
 * (the underlying service, or the developer's fix, can change on the next
 * attempt).
 *
 * `start-development-server.ts` checks for this type (never an error
 * message) to decide whether the worker exits with
 * `supervisor.ts`'s `BOOT_PRECONDITION_EXIT_CODE`, which the supervisor
 * treats as terminal — no restart, no crash-budget spend.
 */
export class BootPreconditionError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BootPreconditionError";
  }
}

/**
 * Whether `error` belongs to the boot-precondition class — checked by TYPE,
 * never by message text, so a legitimate error that happens to share
 * wording with a known failure is never misclassified.
 */
export function isBootPreconditionError(error: unknown): boolean {
  return error instanceof BootPreconditionError || error instanceof PortInUseError;
}
