import type { Model } from "@warlock.js/cascade";
import { Context, contextManager } from "@warlock.js/context";
import type { Request } from "../request";
import type { Response } from "../response";

/**
 * Request Context Store
 */
export type RequestContextStore<User extends Model = Model> = {
  request: Request<User>;
  response: Response;
};

/**
 * Request Context
 *
 * Manages request-scoped data (request, response, user) using AsyncLocalStorage.
 * Extends the base Context class for consistent API.
 */
class RequestContext<User extends Model = Model> extends Context<RequestContextStore<User>> {
  /**
   * Get the current request
   */
  public getRequest(): Request<User> | undefined {
    return this.get("request");
  }

  /**
   * Get the current response
   */
  public getResponse(): Response | undefined {
    return this.get("response");
  }

  /**
   * Get the current user.
   *
   * Reads `request.locals.user` — a key core itself does not declare on
   * `RequestLocals`. `@warlock.js/auth` augments `RequestLocals` with
   * `user?: RequestUser` and its middleware is the sole writer, but core
   * cannot import `@warlock.js/auth` (that would invert the dependency), so
   * this accessor cannot reference the `user` key by name at the type level
   * and instead reads `locals` as an untyped bag. The return type is
   * `unknown`, not the `User` generic above: that generic actually binds
   * `Request<User>`'s `RequestValidation` parameter (see
   * `RequestContextStore`), not "the user type" — there is no `Request`
   * generic for the user today, so returning it as `User` was never sound.
   * Callers that need a concrete model type — e.g.
   * `useCurrentUser<MyUserModel>()` — cast at the call site; the app owns
   * that shape via `@warlock.js/auth`'s `RequestUser` augmentation.
   */
  public getUser(): unknown {
    const locals = this.getRequest()?.locals as Record<string, unknown> | undefined;

    return locals?.user;
  }

  /**
   * Build the initial request store from HTTP context
   */
  public buildStore(payload?: Record<string, any>): RequestContextStore<User> {
    return {
      request: payload?.request,
      response: payload?.response,
    };
  }
}

/**
 * Global request context instance
 */
export const requestContext = new RequestContext();

contextManager.register("request", requestContext);

/**
 * Use request store (for backward compatibility)
 */
export function useRequestStore<UserType extends Model = Model>() {
  return (requestContext.getStore() || {}) as RequestContextStore<UserType>;
}

export function useRequest<UserType extends Model = Model>() {
  return requestContext.getRequest() as Request<UserType>;
}

export function useCurrentUser<UserType extends Model = Model>() {
  // `getUser()` returns `unknown` — core has no type for `request.locals.user`
  // (that key belongs to `@warlock.js/auth`'s `RequestLocals` augmentation).
  // This is the app boundary where the caller's own `RequestUser`
  // augmentation is expected to actually be its `UserType` model instance;
  // `@warlock.js/auth` exposes a typed `currentUser()` helper over this same
  // store for callers that want that guarantee without a manual assertion.
  return requestContext.getUser() as UserType;
}
