import proxy, { type FastifyHttpProxyOptions } from "@fastify/http-proxy";
import fastifyStatic, { type FastifyStaticOptions } from "@fastify/static";
import concatRoute from "@mongez/concat-route";
import { ltrim, merge, toCamelCase, trim } from "@mongez/reinforcements";
import { isEmpty } from "@mongez/supportive-is";
import { log } from "@warlock.js/logger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { container } from "../container";
import { Request } from "../http/request";
import { Response } from "../http/response";
import { type FastifyInstance } from "../http/server";
import { RouteBuilder } from "./route-builder";
import { RouteRegistry } from "./route-registry";
import type {
  GroupedRoutesOptions,
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
    return this.get(from, (_request, response) => {
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
    return this.get(path, (_request, response) => {
      response.sendFile(location, cacheTime);
    });
  }

  /**
   * Serve cached file, it will cache the file to 1 year by default
   */
  public cachedFile(path: string, location: string, cacheTime?: number) {
    return this.get(path, (_request, response) => {
      response.sendCachedFile(location, cacheTime);
    });
  }

  /**
   * Serve list of files
   */
  public files(files: Record<string, string>, cacheTime?: number) {
    for (const [path, location] of Object.entries(files)) {
      this.get(path, (_request, response) => {
        response.sendFile(location, cacheTime);
      });
    }
  }

  /**
   * Serve list of cached files, it will cache the file to 1 year by default
   */
  public cachedFiles(files: Record<string, string>, cacheTime?: number) {
    for (const [path, location] of Object.entries(files)) {
      this.get(path, (_request, response) => {
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
      return concatRoute(path, prefix);
    }, "");

    const name = this.stacks.name.reduceRight(
      (name, prefixName) => {
        return trim(prefixName + "." + name, ".");
      },
      options.name || trim(path.replace(/\//g, "."), "."),
    );

    path = concatRoute(prefix, path);

    const middlewarePrecedence = options.middlewarePrecedence || "after";

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

    if (routeData.name) {
      // check if the name exists
      const route = this.routes.find((route) => route.name === routeData.name);

      if (route) {
        // check again if the route name exists with the same method
        if (route.method === routeData.method) {
          throw new Error(`Route name "${routeData.name}" already exists`);
        } else {
          routeData.name += `.${routeData.method.toLowerCase()}`;
        }
      }
    }

    this.routes.push(routeData);

    this.routesVersion++;

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
    return this.prefix(path, () => {
      path = "";
      // get base resource name
      const baseResourceName = options.name || toCamelCase(ltrim(path, "/"));

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
        const resourceName = baseResourceName + ".list";
        this.get(path, options.replace?.list || routeResource.list.bind(routeResource), {
          ...options,
          name: resourceName,
          restful: true,
        });
      }

      if (routeResource.get && isAcceptableResource("get")) {
        const resourceName = baseResourceName + ".single";

        this.get(path + "/:id", options.replace?.get || routeResource.get.bind(routeResource), {
          ...options,
          name: resourceName,
          restful: true,
        });
      }

      if (routeResource.create && isAcceptableResource("create")) {
        const resourceName = baseResourceName + ".create";

        const handler = options.replace?.create || this.manageValidation(routeResource, "create");

        this.post(path, handler, {
          ...options,
          name: resourceName,
          restful: true,
        });
      }

      if (routeResource.update && isAcceptableResource("update")) {
        const resourceName = baseResourceName + ".update";

        const handler = options.replace?.update || this.manageValidation(routeResource, "update");

        this.put(path + "/:id", handler, {
          ...options,
          name: resourceName,
          restful: true,
        });
      }

      if (routeResource.patch && isAcceptableResource("patch")) {
        const resourceName = baseResourceName + ".patch";

        const handler = options.replace?.patch || this.manageValidation(routeResource, "patch");

        this.patch(path + "/:id", handler, {
          ...options,
          name: resourceName,
          restful: true,
        });
      }

      if (routeResource.delete && isAcceptableResource("delete")) {
        const resourceName = baseResourceName + ".delete";

        this.delete(
          path + "/:id",
          options.replace?.delete || routeResource.delete.bind(routeResource),
          {
            ...options,
            name: resourceName,
            restful: true,
          },
        );
      }

      if (routeResource.bulkDelete && isAcceptableResource("delete")) {
        const resourceName = baseResourceName + ".bulkDelete";

        this.delete(
          path,
          options.replace?.bulkDelete || routeResource.bulkDelete.bind(routeResource),
          {
            ...options,
            name: resourceName,
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
    this.routes = this.routes.filter((route) => route.sourceFile !== sourceFile);

    this.routesVersion++;
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
        validation.validate = async (request: Request, response: Response) => {
          if (validationMethods.all) {
            const output = await validationMethods.all.call(resource, request, response);

            if (output) return output;
          }

          if (validationMethods[method]) {
            return await validationMethods[method]?.call(resource, request, response);
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
    this.eventListeners.beforeScan?.forEach((callback) => callback(this, server));

    this.routes.forEach((route) => {
      const requestMethod = route.method.toLowerCase();
      const requestMethodFunction = server[requestMethod].bind(server);

      const options = {
        ...route.serverOptions,
        config: {
          ...route.serverOptions?.config,
          ...(route.rateLimit && { rateLimit: route.rateLimit }),
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
    this.eventListeners.beforeScan?.forEach((callback) => callback(this, server));

    let routeRegistry: RouteRegistry | undefined;
    let registryVersion = -1;

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
        return fastifyReply.code(404).send({
          error: "Route not found",
          path: fastifyRequest.url,
          method: fastifyRequest.method,
        });
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

    // Register wildcard route for all methods EXCEPT OPTIONS (to avoid conflict with CORS)
    // OPTIONS is handled by @fastify/cors plugin for preflight requests
    const methods = ["GET", "POST", "PUT", "DELETE", "PATCH"] as const;
    for (const method of methods) {
      server.route({
        method,
        url: "*",
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
  public getRoute(name: string, params: any = {}) {
    const route = this.routes.find((route) => route.name === name);

    if (!route) {
      throw new Error(`Route name "${name}" not found`);
    }

    let path = route.path;

    if (route.path.includes(":")) {
      Object.keys(params).forEach((key) => {
        path = path.replace(":" + key, params[key]);
      });
    }

    return path;
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

      request.setRequest(fastifyRequest).setRoute(route);

      log.info({
        module: "route",
        action: route.method + " " + route.path.replace("/*", ""),
        message: `Starting Request: ${request.id}`,
        context: {
          request,
          response,
        },
      });

      const result = await request.execute();

      return {
        output: result,
        response,
        request,
      };
    };
  }
}

export const router = Router.getInstance();

container.set("router", router);
