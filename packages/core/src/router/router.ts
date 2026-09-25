import proxy, { type FastifyHttpProxyOptions } from "@fastify/http-proxy";
import fastifyStatic, { type FastifyStaticOptions } from "@fastify/static";
import { ltrim, merge, toCamelCase, trim } from "@mongez/reinforcements";
import { isEmpty } from "@mongez/supportive-is";
import { log } from "@warlock.js/logger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { container } from "../container";
import { buildCorsOptions } from "../http/build-cors-options";
import { Request } from "../http/request";
import { Response } from "../http/response";
import { type FastifyInstance } from "../http/server";
import { buildTracingContext, dispatchPhase, isTracingEnabled } from "../http/tracing";
import { describeRouteForLog } from "./describe-route-for-log";
import { logRequestLifecycle } from "./log-request-lifecycle";
import {
  forgetPositionalHandlerSuspects,
  inspectHandlerSignature,
  reportPositionalHandlerSuspects,
} from "./positional-handler-diagnostics";
import { normalizeRoutePath } from "./normalize-route-path";
import { RouteBuilder } from "./route-builder";
import { buildRouteRateLimit } from "./build-route-rate-limit";
import { DEV_DISPATCH_METHODS, buildNotFoundBody, createDevRateLimiter } from "./dev-dispatch";
import { RouteRegistry } from "./route-registry";
import { routeNameMethodSuffix } from "./route-name-method-suffix";
import type {
  GroupedRoutesOptions,
  HttpContext,
  NamedApiRoute,
  RequestHandler,
  RequestHandlerType,
  RequestHandlerValidation,
  ResourceMethod,
  Route,
  RouteOptions,
  RouteResource,
  RouterGroupCallback,
  RouterStacks,
} from "./types";

/**
 * A Fastify lifecycle hook as it may be declared in a route's `serverOptions`.
 * Fastify accepts a single hook or an array in either position.
 */
type RouteLifecycleHook = (
  request: FastifyRequest,
  reply: FastifyReply,
) => unknown | Promise<unknown>;

/**
 * The pre-handler phases the dev server forwards from a route's `serverOptions`.
 *
 * These are the admission-control phases and they share the `(request, reply)`
 * signature. `preParsing` is deliberately absent — it must return the payload
 * stream, so forwarding it generically would corrupt the body rather than
 * guard it. `bodyLimit` cannot be forwarded at all; Fastify reads it at
 * registration time and no hook can bound a body already being parsed.
 */
const FORWARDED_ROUTE_PHASES = ["onRequest", "preValidation", "preHandler"] as const;

type ForwardedRoutePhase = (typeof FORWARDED_ROUTE_PHASES)[number];

/**
 * The route the dev dispatcher matched, stashed on the request so the hooks and
 * the wildcard handler all act on one match rather than each matching again.
 */
type DevMatchedRoute = { route: Route; params: Record<string, string> };

type DevDispatchRequest = FastifyRequest & {
  matchedDevRoute?: DevMatchedRoute;
};

function toHookList(
  hook: RouteLifecycleHook | RouteLifecycleHook[] | undefined,
): RouteLifecycleHook[] {
  if (!hook) {
    return [];
  }

  return Array.isArray(hook) ? hook : [hook];
}

/**
 * Run a matched route's hooks for one phase.
 *
 * Returning the reply is how an async Fastify hook signals that it has answered
 * the request; the chain must stop there, so the value is propagated rather
 * than discarded.
 */
async function runRouteHooks(
  route: Route,
  phase: ForwardedRoutePhase,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const hooks = toHookList(
    route.serverOptions?.[phase] as RouteLifecycleHook | RouteLifecycleHook[] | undefined,
  );

  for (const hook of hooks) {
    const outcome = await hook(request, reply);

    if (outcome === reply) {
      return reply;
    }
  }

  return undefined;
}

/**
 * Describe one claimant of a route name, for the duplicate-name error.
 *
 * `warlock dev` registers SSR page routes on the same router as API routes, so
 * the two share a single route-name namespace and collide across kinds. The
 * error is only actionable if it says which claimant is which, so `isPage` —
 * the router's only route-kind discriminator — is what separates them here.
 *
 * `sourceFile` is stamped only on routes registered through `withSourceFile`.
 * Routes registered without that scope have no owner, so say the source is
 * unknown rather than printing an empty string.
 */
function describeRouteClaimant(route: Route) {
  const type = route.isPage ? "page route" : "API route";
  const source = route.sourceFile ? `declared in ${route.sourceFile}` : "source file unknown";

  return `${type} ${route.method} ${route.path} (${source})`;
}

export class Router {
  /**
   * Routes list
   */
  private routes: Route[] = [];

  /**
   * Bumped on every mutation of {@link routes}.
   *
   * The dev dispatcher caches a route registry and needs to know when it is
   * stale. Comparing `routes.length` would miss an HMR reload that replaces a
   * route without changing the count — the registry would then keep matching
   * paths that no longer exist. A version counter cannot miss that.
   */
  private routesVersion = 0;

  /**
   * In-progress atomic replacement, when one exists. Reads continue to use
   * {@link routes}; mutations and collision checks use this isolated draft.
   */
  private routeReplacementTransaction?: {
    routes: Route[];
    removedSourceFiles: Set<string>;
    addedRoutes: Route[];
  };

  /**
   * Router Instance
   */
  private static instance: Router;

  /**
   * Static paths
   */
  protected staticDirectories: FastifyStaticOptions[] = [];

  /**
   * Event listeners
   */
  protected eventListeners: Record<string, ((router: Router, server: FastifyInstance) => void)[]> =
    {};

  /**
   * Stacks
   * Stacks will be used for grouping routes to add prefix, name or middleware
   */
  protected stacks: RouterStacks = {
    prefix: [],
    name: [],
    middleware: [],
  };

  /**
   * Get router instance
   */
  public static getInstance() {
    if (!Router.instance) {
      Router.instance = new Router();
    }

    return Router.instance;
  }

  private constructor() {
    //
  }

  /**
   * Listen to router before scan
   */
  public beforeScanning(callback: (router: Router, server: FastifyInstance) => void) {
    this.eventListeners.beforeScan = [...(this.eventListeners.beforeScan || []), callback];

    return this;
  }

  /**
   * Listen to router after scanning
   */
  public afterScanning(callback: (router: Router, server: FastifyInstance) => void) {
    this.eventListeners.afterScanning = [...(this.eventListeners.afterScanning || []), callback];

    return this;
  }

  /**
   * Redirect path to another path
   */
  public redirect(from: string, to: string, redirectMode: "temporary" | "permanent" = "temporary") {
    return this.get(from, ({ response }) => {
      response.redirect(to, redirectMode === "temporary" ? 302 : 301);
    });
  }

  /**
   * Server static folder
   */
  public directory(options: FastifyStaticOptions) {
    this.staticDirectories.push(options);

    return this;
  }

  /**
   * Serve file
   */
  public file(path: string, location: string, cacheTime?: number) {
    return this.get(path, ({ response }) => {
      response.sendFile(location, cacheTime);
    });
  }

  /**
   * Serve cached file, it will cache the file to 1 year by default
   */
  public cachedFile(path: string, location: string, cacheTime?: number) {
    return this.get(path, ({ response }) => {
      response.sendCachedFile(location, cacheTime);
    });
  }

  /**
   * Serve list of files
   */
  public files(files: Record<string, string>, cacheTime?: number) {
    for (const [path, location] of Object.entries(files)) {
      this.get(path, ({ response }) => {
        response.sendFile(location, cacheTime);
      });
    }
  }

  /**
   * Serve list of cached files, it will cache the file to 1 year by default
   */
  public cachedFiles(files: Record<string, string>, cacheTime?: number) {
    for (const [path, location] of Object.entries(files)) {
      this.get(path, ({ response }) => {
        response.sendCachedFile(location, cacheTime);
      });
    }
  }

  /**
   * Add proxy route
   */
  public proxy(
    path: string,
    baseUrl: string,
    options?: Omit<FastifyHttpProxyOptions, "prefix" | "upstream">,
  ): this;
  public proxy(options: FastifyHttpProxyOptions): this;
  public proxy(...args: any[]) {
    this.beforeScanning((_router, server) => {
      if (args.length === 1) {
        server.register(proxy, args[0]);
      } else {
        server.register(proxy, {
          prefix: args[0],
          upstream: args[1],
          ...args[2],
        });
      }
    });

    return this;
  }

  /**
   * Add route to routes list
   */
  public add(
    method: Route["method"],
    path: string | string[],
    handler: RequestHandlerType,
    options: RouteOptions = {},
  ) {
    if (Array.isArray(path)) {
      path.forEach((p) => this.add(method, p, handler, options));
      return this;
    }

    const prefix = this.stacks.prefix.reduce((path, prefix) => {
      return normalizeRoutePath(path, prefix);
    }, "");

    const name = this.stacks.name.reduceRight(
      (name, prefixName) => {
        return trim(prefixName + "." + name, ".");
      },
      options.name || trim(path.replace(/\//g, "."), "."),
    );

    // The one place a route path becomes canonical. `normalizeRoutePath` is
    // exported so the build-time page-route manifest can produce the very same
    // string without registering anything.
    path = normalizeRoutePath(prefix, path);

    const middlewarePrecedence = options.middlewarePrecedence || "after";

    // Work on a copy: the caller may reuse one options object for several
    // routes, and merging the group stack into it would compound per route.
    options = { ...options };

    if (middlewarePrecedence === "before") {
      options.middleware = [...(options.middleware || []), ...this.stacks.middleware];
    } else {
      options.middleware = [...this.stacks.middleware, ...(options.middleware || [])];
    }

    if (Array.isArray(handler)) {
      const [controller, action] = handler;

      if (typeof controller[action] !== "function") {
        throw new Error(
          `Invalid controller action "${action}" for controller "${controller.constructor.name}"`,
        );
      }

      handler = controller[action].bind(controller) as RequestHandler;

      if (!handler.validation) {
        handler.validation = {};
        if (controller[`${action}ValidationSchema`]) {
          handler.validation.schema = controller[`${action}ValidationSchema`]();
        }

        if (controller[`${action}Validate`]) {
          handler.validation.validate = controller[`${action}Validate`];
        }
      }
    }

    const routeData: Route = {
      method,
      path,
      handler,
      ...options,
      name,
      rateLimit: options.rateLimit,
      $prefix: prefix || "/",
      // it must be a new array to avoid modifying the original array
      $prefixStack: [...this.stacks.prefix],
      // Inject source file from stacks if set
      sourceFile: this.stacks.sourceFile || "",
    };

    const routes = this.routeReplacementTransaction?.routes ?? this.routes;

    if (routeData.name) {
      // check if the name exists
      const route = routes.find((route) => route.name === routeData.name);

      if (route) {
        // check again if the route name exists with the same method
        if (route.method === routeData.method) {
          throw new Error(
            `Route name "${routeData.name}" is already taken.\n` +
              `  already registered: ${describeRouteClaimant(route)}\n` +
              `  now being added:    ${describeRouteClaimant(routeData)}\n` +
              `Pages and API routes share one route-name namespace, so a name can only be ` +
              `claimed once. Rename one of them via the "name" route option.`,
          );
        } else {
          routeData.name += routeNameMethodSuffix(routeData.method);
        }
      }
    }

    // Registration-time only — nothing here runs per request. Suspects are
    // collected now and reported together at boot (see `scan`), so a route file
    // written against v4 produces one legible list instead of a mystery 500 per
    // request. Recorded after the collision check so a route that never lands
    // is never reported.
    if (this.routeReplacementTransaction) {
      this.routeReplacementTransaction.addedRoutes.push(routeData);
    } else {
      inspectHandlerSignature(routeData.handler, routeData);
    }

    routes.push(routeData);

    if (!this.routeReplacementTransaction) {
      this.routesVersion++;
    }

    return this;
  }

  /**
   * Add a request that accepts all methods
   */
  public any(path: string, handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("all" as Route["method"], path, handler, options);
  }

  /**
   * Add get request method
   */
  public get(path: string, handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("GET", path, handler, options);
  }

  /**
   * Add post request method
   */
  public post(path: string | string[], handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("POST", path, handler, options);
  }

  /**
   * Add put request method
   */
  public put(path: string, handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("PUT", path, handler, options);
  }

  /**
   * Add delete request method
   */
  public delete(path: string | string[], handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("DELETE", path, handler, options);
  }

  /**
   * Add patch request method
   */
  public patch(path: string, handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("PATCH", path, handler, options);
  }

  /**
   * Add head request method
   */
  public head(path: string, handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("HEAD", path, handler, options);
  }

  /**
   * Add options request method
   */
  public options(path: string, handler: RequestHandlerType, options: RouteOptions = {}) {
    return this.add("OPTIONS", path, handler, options);
  }

  /**
   * Get a chainable route builder for the same route path
   */
  public route(path: string, options: RouteOptions = {}) {
    return new RouteBuilder(this, path, options);
  }

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
  public restfulResource(
    path: string,
    resource: RouteResource,
    options: RouteOptions & {
      only?: ResourceMethod[];
      except?: ResourceMethod[];
      replace?: Partial<Record<ResourceMethod, RequestHandler>> & {
        bulkDelete?: RequestHandler;
      };
    } = {},
  ) {
    // Derive the base resource name from the path before the group below
    // clears it for use as the routes' relative path. `options.name`, when
    // given, replaces the path-derived name entirely (see the explicit
    // `name` passed to `group()`) rather than composing with it.
    const baseResourceName = options.name || toCamelCase(ltrim(path, "/"));

    return this.group({ prefix: path, name: baseResourceName }, () => {
      const path = "";

      // clone the resource so we don't mess up with it
      const routeResource = resource;

      const isAcceptableResource = (type: ResourceMethod) => {
        return Boolean(
          // check if the route is not excluded
          (!options.except || !options.except.includes(type)) &&
          // check if the only option is set and the route is included
          (!options.only || options.only.includes(type)),
        );
      };

      if (routeResource.list && isAcceptableResource("list")) {
        this.get(path, options.replace?.list || routeResource.list.bind(routeResource), {
          ...options,
          name: "list",
          restful: true,
        });
      }

      if (routeResource.get && isAcceptableResource("get")) {
        this.get(path + "/:id", options.replace?.get || routeResource.get.bind(routeResource), {
          ...options,
          name: "single",
          restful: true,
        });
      }

      if (routeResource.create && isAcceptableResource("create")) {
        const handler = options.replace?.create || this.manageValidation(routeResource, "create");

        this.post(path, handler, {
          ...options,
          name: "create",
          restful: true,
        });
      }

      if (routeResource.update && isAcceptableResource("update")) {
        const handler = options.replace?.update || this.manageValidation(routeResource, "update");

        this.put(path + "/:id", handler, {
          ...options,
          name: "update",
          restful: true,
        });
      }

      if (routeResource.patch && isAcceptableResource("patch")) {
        const handler = options.replace?.patch || this.manageValidation(routeResource, "patch");

        this.patch(path + "/:id", handler, {
          ...options,
          name: "patch",
          restful: true,
        });
      }

      if (routeResource.delete && isAcceptableResource("delete")) {
        this.delete(
          path + "/:id",
          options.replace?.delete || routeResource.delete.bind(routeResource),
          {
            ...options,
            name: "delete",
            restful: true,
          },
        );
      }

      if (routeResource.bulkDelete && isAcceptableResource("delete")) {
        this.delete(
          path,
          options.replace?.bulkDelete || routeResource.bulkDelete.bind(routeResource),
          {
            ...options,
            name: "bulkDelete",
            restful: true,
          },
        );
      }

      return this;
    });
  }

  /**
   * Group routes with options
   */
  public group(options: GroupedRoutesOptions, callback: RouterGroupCallback) {
    const {
      prefix,
      // name must always be defined because
      // if there are multiple groups without name
      // they might generate the same route name
      // thus causing an error
      // in this case we need always to make sure that
      // the name is always defined.
      name = prefix ? trim(prefix.replace(/\//g, "."), ".") : undefined,
      middleware,
    } = options;

    if (prefix) {
      this.stacks.prefix.push(prefix);
    }

    if (name) {
      this.stacks.name.push(name);
    }

    if (middleware) {
      this.stacks.middleware.push(...middleware);
    }

    try {
      callback();
    } finally {
      // Always pop/splice this group's stacks, even if the callback throws,
      // so a throwing group never leaks state onto the process-global singleton.
      if (prefix) {
        this.stacks.prefix.pop();
      }

      if (name) {
        this.stacks.name.pop();
      }

      if (middleware) {
        this.stacks.middleware.splice(
          this.stacks.middleware.length - middleware.length,
          middleware.length,
        );
      }
    }

    return this;
  }

  /**
   * Add prefix to all routes in the given callback
   */
  public prefix(prefix: string, callback: () => void) {
    return this.group({ prefix }, callback);
  }

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
  public version(version: string | number, callback: () => void) {
    return this.prefix(`/v${version}`, callback);
  }

  /**
   * Wrap route additions with a source file path
   * Used for tracking which routes come from which file (for HMR)
   * @param sourceFile Relative path to the source file (e.g., "src/app/users/routes.ts")
   * @param callback Function that adds routes (will have sourceFile injected)
   */
  public async withSourceFile<T = any>(
    sourceFile: string,
    callback: () => T | Promise<T>,
  ): Promise<T | undefined> {
    // Set source file in stacks
    this.stacks.sourceFile = sourceFile;

    try {
      // Execute callback (routes added here will have sourceFile injected)
      return await callback();
    } catch (error) {
      // Log loudly, then RETHROW. Swallowing here silently dropped a whole
      // route file (duplicate name, invalid action, import error) so the
      // surface 404'd with no boot error. The caller decides what a throw
      // means: at boot it aborts the boot, during HMR the dev server's
      // batch-reload handler catches it, prints it, and keeps serving.
      log.error({
        module: "router",
        action: "registerRoutes",
        message: `Failed to register routes from "${sourceFile}"`,
        context: { sourceFile, error },
      });

      throw error;
    } finally {
      // Always clear source file from stacks so a throwing file never leaks
      // its sourceFile onto the process-global singleton.
      delete this.stacks.sourceFile;
    }
  }

  /**
   * Remove all routes that belong to a specific source file
   * Used when reloading routes files via HMR
   * @param sourceFile Relative path to the source file
   */
  public removeRoutesBySourceFile(sourceFile: string): void {
    if (this.routeReplacementTransaction) {
      this.routeReplacementTransaction.routes = this.routeReplacementTransaction.routes.filter(
        (route) => route.sourceFile !== sourceFile,
      );
      this.routeReplacementTransaction.removedSourceFiles.add(sourceFile);
      return;
    }

    this.routes = this.routes.filter((route) => route.sourceFile !== sourceFile);

    // Keep the signature diagnostics in step, so a reload that fixes a handler
    // stops reporting the version it replaced.
    forgetPositionalHandlerSuspects(sourceFile);

    this.routesVersion++;
  }

  /**
   * Atomically replace every route owned by the given exact source-file keys.
   *
   * The installer mutates an isolated draft. Public reads keep seeing the old
   * live table across awaits, and a failed installer discards every draft
   * mutation. A successful installer swaps the whole draft in one synchronous
   * commit and invalidates the dev route registry exactly once.
   */
  public async replaceRoutesBySourceFiles<T>(
    sourceFiles: Iterable<string>,
    install: () => T | Promise<T>,
  ): Promise<T> {
    if (this.routeReplacementTransaction) {
      throw new Error("Cannot nest route replacement transactions");
    }

    const removedSourceFiles = new Set(sourceFiles);

    this.routeReplacementTransaction = {
      routes: this.routes.filter((route) => !removedSourceFiles.has(route.sourceFile)),
      removedSourceFiles,
      addedRoutes: [],
    };

    try {
      const result = await install();
      const transaction = this.routeReplacementTransaction!;

      this.routes = transaction.routes;
      this.routeReplacementTransaction = undefined;

      // Diagnostic state follows the same commit boundary as the route table.
      // Added routes were deliberately not inspected while still speculative.
      for (const sourceFile of transaction.removedSourceFiles) {
        forgetPositionalHandlerSuspects(sourceFile);
      }

      const committedRoutes = new Set(transaction.routes);

      for (const route of transaction.addedRoutes) {
        if (committedRoutes.has(route)) {
          inspectHandlerSignature(route.handler, route);
        }
      }

      this.routesVersion++;

      return result;
    } catch (error) {
      this.routeReplacementTransaction = undefined;
      throw error;
    }
  }

  /**
   * Manage validation system for the given resource
   */
  private manageValidation(resource: RouteResource, method: "create" | "update" | "patch") {
    const handler = resource[method]?.bind(resource) as RequestHandler;

    const methodValidation = resource?.validation?.[method];

    if (method === "patch") {
      handler.validation = methodValidation;

      if (handler.validation?.validate) {
        handler.validation.validate = handler.validation.validate.bind(resource);
      }

      if (resource.validation?.patch) {
        handler.validation = merge(resource.validation.patch, handler.validation);
      }

      return handler;
    }

    if (!resource.validation || (!methodValidation && !resource.validation.all)) return handler;

    if (resource.validation.all) {
      const validationMethods = {
        all: resource?.validation?.all?.validate,
        [method]: methodValidation?.validate,
      };

      const validation: RequestHandlerValidation = {};

      if (resource.validation.all.schema || methodValidation?.schema) {
        if (!methodValidation?.schema && resource.validation.all.schema) {
          // Case 2: Only all.schema exists - clone it for this method
          validation.schema = resource.validation.all.schema;
        } else if (methodValidation?.schema && resource.validation.all.schema) {
          // Case 3: Both exist - merge them (all is base, method overrides)
          validation.schema = resource.validation.all.schema.merge(methodValidation.schema);
        } else if (methodValidation?.schema && !resource.validation.all.schema) {
          // Case 1: Only method schema exists - use it directly
          validation.schema = methodValidation.schema;
        }
        // Case 4: Neither exists - handled by outer if being false
      }

      if (validationMethods.all || validationMethods[method]) {
        validation.validate = async ({ request, response }: HttpContext) => {
          if (validationMethods.all) {
            const output = await validationMethods.all.call(resource, { request, response });

            if (output) return output;
          }

          if (validationMethods[method]) {
            return await validationMethods[method]?.call(resource, { request, response });
          }

          return;
        };
      }

      if (!isEmpty(validation)) {
        handler.validation = validation;
      }
    } else {
      handler.validation = resource.validation[method];

      if (handler.validation?.validate) {
        handler.validation.validate = handler.validation.validate.bind(resource);
      }
    }

    return handler;
  }

  /**
   * Get all routes list
   */
  public list() {
    return this.routes;
  }

  /**
   * Return fresh browser-safe snapshots of named, non-page routes.
   *
   * Names are the registered names, including method suffixes. `all` stays
   * intact as route metadata; consumers decide whether their use supports it.
   */
  public getNamedApiRoutes(): readonly NamedApiRoute[] {
    return Object.freeze(
      this.routes
        .filter((route) => !route.isPage && typeof route.name === "string" && route.name.length > 0)
        .map((route) => Object.freeze({ name: route.name!, path: route.path, method: route.method })),
    );
  }

  /**
   * Number of routes currently registered on the singleton.
   *
   * Used as a readiness signal: a successful boot that ends up with zero
   * routes almost always means a route module failed to register silently
   * (see `withSourceFile`), so callers can surface that instead of letting
   * the whole surface 404.
   */
  public routeCount(): number {
    return this.routes.length;
  }

  /**
   * Register routes to the server
   */
  public scan(server: FastifyInstance) {
    // Every route is registered by the time we scan, so this is the first
    // moment the whole list can be reported at once — and it is still before a
    // single request is served.
    reportPositionalHandlerSuspects();

    this.eventListeners.beforeScan?.forEach((callback) => callback(this, server));

    // Fastify automatically exposes HEAD for every GET route. When an app
    // declares its own HEAD route at the same path, suppress only that GET
    // route's implicit registration so the explicit handler owns HEAD,
    // regardless of declaration order.
    const explicitHeadPaths = new Set(
      this.routes
        .filter((route) => route.method.toLowerCase() === "head")
        .map((route) => route.path),
    );

    this.routes.forEach((route) => {
      const requestMethod = route.method.toLowerCase();
      const requestMethodFunction = server[requestMethod].bind(server);

      const options = {
        ...route.serverOptions,
        ...(requestMethod === "get" &&
          explicitHeadPaths.has(route.path) && { exposeHeadRoute: false }),
        config: {
          ...route.serverOptions?.config,
          ...(route.rateLimit && { rateLimit: buildRouteRateLimit(route.rateLimit) }),
        },
      };

      requestMethodFunction(
        route.path,
        options,
        async (baseRequest: FastifyRequest, reply: FastifyReply) => {
          const { output, response } = await this.handleRoute(route)(baseRequest, reply);

          return output || response.baseResponse;
        },
      );
    });

    for (const directoryOptions of this.staticDirectories) {
      server.register(fastifyStatic, {
        ...directoryOptions,
        decorateReply: false,
      });
    }

    this.eventListeners.afterScanning?.forEach((callback) => callback(this, server));
  }

  /**
   * Scan routes for the development server
   * Uses wildcard routing with find-my-way for HMR support
   */
  public scanDevServer(server: FastifyInstance) {
    // Same boot-time report as production `scan`. Routes reloaded later by HMR
    // are still recorded, but only surface on the next scan or via
    // `warlock doctor`.
    reportPositionalHandlerSuspects();

    this.eventListeners.beforeScan?.forEach((callback) => callback(this, server));

    let routeRegistry: RouteRegistry | undefined;
    let registryVersion = -1;

    const applyDevRateLimit = createDevRateLimiter(server);

    // Rebuilt when the route table changes rather than per request. Building it
    // inside the handler re-registered every route on every hit — and `all`
    // routes expand into seven registrations each. Keyed on `routesVersion`
    // rather than on the route count, so an HMR reload that swaps a route
    // without changing the count still invalidates.
    const resolveRouteRegistry = () => {
      if (routeRegistry && registryVersion === this.routesVersion) {
        return routeRegistry;
      }

      routeRegistry = new RouteRegistry();

      routeRegistry.register(this.routes);

      registryVersion = this.routesVersion;

      return routeRegistry;
    };

    // Matching happens here, in Fastify's own onRequest phase, so a route's
    // `serverOptions.onRequest` still runs BEFORE body parsing. Production
    // `scan()` gets that from per-route registration; the wildcard dispatcher
    // has no per-route slot, so without this the hook silently never runs.
    server.addHook(
      "onRequest",
      async (fastifyRequest: FastifyRequest, fastifyReply: FastifyReply) => {
        const match = resolveRouteRegistry().find(fastifyRequest.method, fastifyRequest.url);

        if (!match) {
          return undefined;
        }

        (fastifyRequest as DevDispatchRequest).matchedDevRoute = match;

        fastifyRequest.params = match.params;

        // Same slot production gives it: the limiter runs first in onRequest,
        // ahead of the route's own hooks.
        await applyDevRateLimit(match.route, fastifyRequest, fastifyReply);

        if (fastifyReply.sent) {
          return fastifyReply;
        }

        return runRouteHooks(match.route, "onRequest", fastifyRequest, fastifyReply);
      },
    );

    for (const phase of FORWARDED_ROUTE_PHASES.filter((name) => name !== "onRequest")) {
      server.addHook(phase, async (fastifyRequest: FastifyRequest, fastifyReply: FastifyReply) => {
        const match = (fastifyRequest as DevDispatchRequest).matchedDevRoute;

        if (!match) {
          return undefined;
        }

        return runRouteHooks(match.route, phase, fastifyRequest, fastifyReply);
      });
    }

    // Shared handler for wildcard routing
    const wildcardHandler = async (fastifyRequest: FastifyRequest, fastifyReply: FastifyReply) => {
      const match = (fastifyRequest as DevDispatchRequest).matchedDevRoute;

      // No match found - return 404
      if (!match) {
        return fastifyReply
          .code(404)
          .send(buildNotFoundBody(fastifyRequest.method, fastifyRequest.url));
      }

      try {
        // Call the matched route handler
        const { output, response } = await this.handleRoute(match.route)(
          fastifyRequest,
          fastifyReply,
        );

        return output || response.baseResponse;
      } catch (error) {
        log.error("router", "dev-dispatch", error as Error, {
          method: fastifyRequest.method,
          url: fastifyRequest.url,
        });

        throw error;
      }
    };

    // Every verb production can register. Fastify's implicit HEAD for the GET
    // wildcard is switched off so the HEAD wildcard owns it (the registry falls
    // back to the GET route, exactly as production's implicit HEAD does).
    // `@fastify/cors` registers its own OPTIONS "*" catch-all whenever
    // preflight is on. Plugins load after this runs, so `hasRoute` cannot see
    // it yet: decide from the same options the cors plugin receives.
    const corsOwnsPreflight = buildCorsOptions().preflight !== false;

    for (const method of DEV_DISPATCH_METHODS) {
      if (method === "OPTIONS" && (corsOwnsPreflight || server.hasRoute({ method: "OPTIONS", url: "*" }))) {
        continue;
      }

      server.route({
        method,
        url: "*",
        ...(method === "GET" && { exposeHeadRoute: false }),
        handler: wildcardHandler,
      });
    }

    // Register static directories
    for (const directoryOptions of this.staticDirectories) {
      server.register(fastifyStatic, {
        ...directoryOptions,
        decorateReply: false,
      });
    }

    this.eventListeners.afterScanning?.forEach((callback) => callback(this, server));
  }

  /**
   * Get the route path for the given route name
   */
  public getRoute(name: string, params: Record<string, any> = {}) {
    const route = this.routes.find((route) => route.name === name);

    if (!route) {
      throw new Error(`Route name "${name}" not found`);
    }

    const used = new Set<string>();

    const path = route.path.replace(/:([A-Za-z0-9_]+)(\?)?/g, (_match, key: string, optional) => {
      const value = params[key];

      if (value === undefined || value === null) {
        if (optional) return "";

        throw new Error(`Route "${name}" is missing the "${key}" param`);
      }

      used.add(key);

      return encodeURIComponent(String(value));
    });

    const query = Object.keys(params)
      .filter((key) => !used.has(key) && params[key] !== undefined && params[key] !== null)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
      .join("&");

    return query ? `${path}?${query}` : path;
  }

  /**
   * Handle the given route
   */
  private handleRoute(route: Route) {
    return async (fastifyRequest: FastifyRequest, fastifyResponse: FastifyReply) => {
      const request = new Request();
      const response = new Response();
      response.setResponse(fastifyResponse);
      request.response = response;

      response.request = request;

      // "route.match" tracing phase: the pattern is
      // already known here (`route.path`), so this brackets the cost of
      // stamping the request/route onto the `Request` instance rather than
      // route-registry matching itself, which happens upstream of this
      // function for both the production `scan()` path and the dev wildcard
      // dispatcher (both funnel into `handleRoute`).
      const tracingEnabled = isTracingEnabled();
      const routeMatchStartedAt = tracingEnabled ? performance.now() : 0;

      request.setRequest(fastifyRequest).setRoute(route);

      if (tracingEnabled) {
        dispatchPhase(buildTracingContext(request), {
          name: "route.match",
          durationMs: performance.now() - routeMatchStartedAt,
          attrs: { route: route.path },
        });
      }

      /*
        Both ends of the entry, not just the start — see
        `log-request-lifecycle.ts`. A start line on its own made a hung request
        and an instant one look identical, and the completion line is what makes
        a MISSING one legible as a hang.
      */
      const result = await logRequestLifecycle(
        {
          info: (entry) => log.info(entry),
          warn: (entry) => log.warn(entry),
          error: (entry) => log.error(entry),
          now: () => performance.now(),
        },
        {
          module: "route",
          action: describeRouteForLog(route.method, route.path),
          requestId: request.id,
          context: { request, response },
          request,
          // Read after the run: the status is decided during the request.
          statusCode: () => fastifyResponse.statusCode,
        },
        () => request.execute(),
      );

      // A handler may return a plain object (`ReturnedResponse`). Route it
      // through `Response.send` so status, events and hooks apply, exactly as
      // middleware outputs already do.
      let output = result;

      if (
        output !== undefined &&
        output !== null &&
        !(output instanceof Response) &&
        (output as unknown) !== fastifyResponse
      ) {
        output = await response.send(output);
      }

      return {
        output,
        response,
        request,
      };
    };
  }
}

export const router = Router.getInstance();

container.set("router", router);
