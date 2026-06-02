import { Request } from "../request.mjs";
import { Response } from "../response.mjs";
import { Model } from "@warlock.js/cascade";
import { Context } from "@warlock.js/context";

//#region ../../@warlock.js/core/src/http/context/request-context.d.ts
/**
 * Request Context Store
 */
type RequestContextStore<User extends Model = Model> = {
  request: Request<User>;
  response: Response;
};
/**
 * Request Context
 *
 * Manages request-scoped data (request, response, user) using AsyncLocalStorage.
 * Extends the base Context class for consistent API.
 */
declare class RequestContext<User extends Model = Model> extends Context<RequestContextStore<User>> {
  /**
   * Get the current request
   */
  getRequest(): Request<User> | undefined;
  /**
   * Get the current response
   */
  getResponse(): Response | undefined;
  /**
   * Get the current user
   */
  getUser(): User | undefined;
  /**
   * Build the initial request store from HTTP context
   */
  buildStore(payload?: Record<string, any>): RequestContextStore<User>;
}
/**
 * Global request context instance
 */
declare const requestContext: RequestContext<Model>;
/**
 * Use request store (for backward compatibility)
 */
declare function useRequestStore<UserType extends Model = Model>(): RequestContextStore<UserType>;
declare function useRequest<UserType extends Model = Model>(): Request<UserType>;
declare function useCurrentUser<UserType extends Model = Model>(): UserType;
//#endregion
export { RequestContextStore, requestContext, useCurrentUser, useRequest, useRequestStore };
//# sourceMappingURL=request-context.d.mts.map