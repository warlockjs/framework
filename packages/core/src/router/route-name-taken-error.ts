import { WarlockError } from "../errors/warlock-error";

/**
 * Thrown when a route is registered under a name another route with the same
 * method already claimed. Pages and API routes share one name namespace.
 */
export class RouteNameTakenError extends WarlockError {
  public constructor(
    public readonly routeName: string,
    message: string,
  ) {
    super("WL3001", message);
    this.name = "RouteNameTakenError";
  }
}
