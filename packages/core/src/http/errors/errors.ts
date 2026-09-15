export class HttpError extends Error {
  public constructor(
    public status: number,
    public message: string,
    public payload?: any,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class ResourceNotFoundError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(404, message, payload);
    this.name = "ResourceNotFoundError";
  }
}

export class UnAuthorizedError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(401, message, payload);
    this.name = "UnAuthorizedError";
  }
}

export class ForbiddenError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(403, message, payload);
    this.name = "ForbiddenError";
  }
}

export class BadRequestError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(400, message, payload);
    this.name = "BadRequestError";
  }
}

export class ServerError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(500, message, payload);
    this.name = "ServerError";
  }
}

export class ConflictError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(409, message, payload);
    this.name = "ConflictError";
  }
}

export class NotAcceptableError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(406, message, payload);
    this.name = "NotAcceptableError";
  }
}

export class NotAllowedError extends HttpError {
  public constructor(
    message: string,
    public payload?: any,
  ) {
    super(405, message, payload);
    this.name = "NotAllowedError";
  }
}

/**
 * Thrown by `Request.prototype.user` in development to catch a call site
 * still reading the removed `request.user` getter/setter after the 5.12.0
 * move: the authenticated user now lives at `request.locals.user`, written
 * by `@warlock.js/auth`'s middleware.
 *
 * Development-only diagnostic, not a runtime contract other code should
 * catch — the getter itself is typed `never`, so a caller that still
 * compiles against `request.user` only does so via `any`/an outdated type.
 * Kept in core (not auth) because `request.user` is a core `Request`
 * accessor and core cannot depend on `@warlock.js/auth` to react to it.
 * Slated for removal one release after 5.12.0 — see the CHANGELOG.
 */
export class RequestUserMovedError extends Error {
  public constructor() {
    super(
      "request.user has been removed. The authenticated user now lives at " +
        "request.locals.user, set by @warlock.js/auth's middleware.",
    );
    this.name = "RequestUserMovedError";
  }
}
