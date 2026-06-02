import { FastifyInstance } from "../http/server.mjs";
import { GroupedRoutesOptions, RequestHandler, RequestHandlerType, ResourceMethod, Route, RouteOptions, RouteResource, RouterGroupCallback, RouterStacks } from "./types.mjs";
import { RouteBuilder } from "./route-builder.mjs";
import { FastifyHttpProxyOptions } from "@fastify/http-proxy";
import { FastifyStaticOptions } from "@fastify/static";

//#region ../../@warlock.js/core/src/router/router.d.ts
declare class Router {
  /**
   * Routes list
   */
  private routes;
  /**
   * Router Instance
   */
  private static instance;
  /**
   * Static paths
   */
  protected staticDirectories: FastifyStaticOptions[];
  /**
   * Event listeners
   */
  protected eventListeners: Record<string, ((router: Router, server: FastifyInstance) => void)[]>;
  /**
   * Stacks
   * Stacks will be used for grouping routes to add prefix, name or middleware
   */
  protected stacks: RouterStacks;
  /**
   * Get router instance
   */
  static getInstance(): Router;
  private constructor();
  /**
   * Listen to router before scan
   */
  beforeScanning(callback: (router: Router, server: FastifyInstance) => void): this;
  /**
   * Listen to router after scanning
   */
  afterScanning(callback: (router: Router, server: FastifyInstance) => void): this;
  /**
   * Redirect path to another path
   */
  redirect(from: string, to: string, redirectMode?: "temporary" | "permanent"): this;
  /**
   * Server static folder
   */
  directory(options: FastifyStaticOptions): this;
  /**
   * Serve file
   */
  file(path: string, location: string, cacheTime?: number): this;
  /**
   * Serve cached file, it will cache the file to 1 year by default
   */
  cachedFile(path: string, location: string, cacheTime?: number): this;
  /**
   * Serve list of files
   */
  files(files: Record<string, string>, cacheTime?: number): void;
  /**
   * Serve list of cached files, it will cache the file to 1 year by default
   */
  cachedFiles(files: Record<string, string>, cacheTime?: number): void;
  /**
   * Add proxy route
   */
  proxy(path: string, baseUrl: string, options?: Omit<FastifyHttpProxyOptions, "prefix" | "upstream">): this;
  proxy(options: FastifyHttpProxyOptions): this;
  /**
   * Add route to routes list
   */
  add(method: Route["method"], path: string | string[], handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add a request that accepts all methods
   */
  any(path: string, handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add get request method
   */
  get(path: string, handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add post request method
   */
  post(path: string | string[], handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add put request method
   */
  put(path: string, handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add delete request method
   */
  delete(path: string | string[], handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add patch request method
   */
  patch(path: string, handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add head request method
   */
  head(path: string, handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Add options request method
   */
  options(path: string, handler: RequestHandlerType, options?: RouteOptions): this;
  /**
   * Get a chainable route builder for the same route path
   */
  route(path: string, options?: RouteOptions): RouteBuilder;
  /**
   * Add full restful resource routes
   * This method will generate the following routes:
   * 1. GET /path: list all resources
   * 2. GET /path/:id: get a single resource
   * 3. POST /path: create a new resource
   * 4. PUT /path/:id: update a resource
   * 5. DELETE /path/:id: delete a resource
   * 6. PATCH /path/:id: update a resource partially
   */
  restfulResource(path: string, resource: RouteResource, options?: RouteOptions & {
    only?: ResourceMethod[];
    except?: ResourceMethod[];
    replace?: Partial<Record<ResourceMethod, RequestHandler>> & {
      bulkDelete?: RequestHandler;
    };
  }): this;
  /**
   * Group routes with options
   */
  group(options: GroupedRoutesOptions, callback: RouterGroupCallback): this;
  /**
   * Add prefix to all routes in the given callback
   */
  prefix(prefix: string, callback: () => void): this;
  /**
   * Add API version prefix to all routes in the given callback
   * Automatically formats the version as /v{version}
   * @example
   * router.version("1", () => {
   *   router.get("/users", getUsersV1); // /v1/users
   * });
   *
   * router.version("2", () => {
   *   router.get("/users", getUsersV2); // /v2/users
   * });
   */
  version(version: string | number, callback: () => void): this;
  /**
   * Wrap route additions with a source file path
   * Used for tracking which routes come from which file (for HMR)
   * @param sourceFile Relative path to the source file (e.g., "src/app/users/routes.ts")
   * @param callback Function that adds routes (will have sourceFile injected)
   */
  withSourceFile<T = any>(sourceFile: string, callback: () => T | Promise<T>): Promise<T | undefined>;
  /**
   * Remove all routes that belong to a specific source file
   * Used when reloading routes files via HMR
   * @param sourceFile Relative path to the source file
   */
  removeRoutesBySourceFile(sourceFile: string): void;
  /**
   * Manage validation system for the given resource
   */
  private manageValidation;
  /**
   * Get all routes list
   */
  list(): Route[];
  /**
   * Register routes to the server
   */
  scan(server: FastifyInstance): void;
  /**
   * Scan routes for the development server
   * Uses wildcard routing with find-my-way for HMR support
   */
  scanDevServer(server: FastifyInstance): void;
  /**
   * Get the route path for the given route name
   */
  getRoute(name: string, params?: any): string;
  /**
   * Handle the given route
   */
  private handleRoute;
}
declare const router: Router;
//#endregion
export { Router, router };
//# sourceMappingURL=router.d.mts.map