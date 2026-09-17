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
 * Thrown by `Request.prototype.cookie` / `Request.prototype.hasCookie` when
 * `@fastify/cookie` was never registered on this Fastify instance, so
 * `baseRequest.cookies` is `undefined` rather than an (possibly empty) object.
 *
 * A by-name cookie read is a deliberate assertion by the caller — "this
 * cookie should be readable here" — so an unavailable jar is a configuration
 * fault, not an absent cookie, and must not be swallowed into a default
 * value or a silent `false`. Contrast `Request.prototype.cookies`, which
 * stays lenient because the framework's own opportunistic reads (e.g.
 * locale resolution) must not throw on a request that simply has no jar.
 */
export class CookieJarUnavailableError extends Error {
  public constructor(cookieName: string) {
    super(
      `Cannot read cookie "${cookieName}": the cookie jar is unavailable because ` +
        "@fastify/cookie is not registered on this Fastify instance. " +
        "Register the plugin (see core's http/plugins.ts) before reading cookies by name.",
    );

    this.name = "CookieJarUnavailableError";
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
