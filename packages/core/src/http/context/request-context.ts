import type { Model } from "@warlock.js/cascade";
import { Context, contextManager } from "@warlock.js/context";
import type { Request } from "../request";
import type { Response } from "../response";
import type { RequestUser } from "../types";

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
   * Reads `request.user`, typed via the `RequestUser` module-augmentation
   * surface (`core/src/http/types.ts`) — NOT the `User` generic above. That
   * generic actually binds `Request<User>`'s `RequestValidation` parameter
   * (see `RequestContextStore`), not "the user type"; there is no `Request`
   * generic for the user today, so returning it as `User` was never sound
   * (eed20184 step (b) inventory, `implementation/2026-08-20-A2-request-locals.md`
   * §6.1). Callers that need a concrete model type — e.g.
   * `useCurrentUser<MyUserModel>()` — cast at the call site; the app owns
   * that shape via its own `RequestUser` augmentation.
   */
  public getUser(): RequestUser | undefined {
    return this.getRequest()?.user;
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
  // `getUser()` returns the declared `RequestUser` surface (empty by
  // default), which is structurally unrelated to `Model` — this is the app
  // boundary where the caller's own `RequestUser` augmentation is expected
  // to actually be its `UserType` model instance. `unknown` is the
  // documented double-assertion for "these ARE the same value, TS just
  // can't see the two augmented shapes are related" — not `any`.
  return requestContext.getUser() as unknown as UserType;
}
