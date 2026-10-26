import type { GenericObject } from "@mongez/reinforcements";
import type { ObjectValidator, ValidationResult } from "@warlock.js/seal";
import type { RouteShorthandOptions } from "fastify";
import type { Request, Response, ReturnedResponse } from "../http";
import type { RequestLoggingOptions } from "../http/request-log-snapshot";
import type { ResponseSchema } from "../resource/types";

/**
 * Middleware response
 */
export type MiddlewareResponse = ReturnedResponse | undefined | void;

/**
 * Middleware method
 * Receives the single context object (`{ request, response }`), same calling
 * convention as `RequestHandler`, and returns a response object or undefined
 * if the request should continue
 */
export type Middleware<MiddlewareRequest extends Request = Request> = {
  (context: HttpContext<MiddlewareRequest>): MiddlewareResponse;
};

export type RouterGroupCallback = () => void;

export type RequestHandlerType = RequestHandler<any> | [GenericObject, string];

/**
 * Resource standard methods
 */
export type ResourceMethod = "list" | "get" | "create" | "update" | "delete" | "patch";

export type RestfulMiddleware = Record<string, [Middleware]>;

export type RequestHandlerValidation<TRequest extends Request = Request> = {
  /**
   * Validation custom message
   */
  validate?: Middleware<TRequest>;
  /**
   * Define what should be validated
   * If not passed, validates body and query plus route params whose names are
   * declared by the object schema. Body and query values take precedence.
   */
  validating?: ("body" | "query" | "params" | "headers")[];
  /**
   * Validation schema
   */
  schema?: ObjectValidator;
  /**
   * Route-parameter schema. Its successful output replaces the matching
   * request params, so `request.input()` sees coerced values.
   *
   * Unlike `schema`, this opt-in never changes how routes without a params
   * schema expose their raw string params.
   */
  params?: ObjectValidator;
  /**
   * Shape the response when `schema` or `params` fails, instead of the
   * framework's `{ errors: [...] }` body.
   *
   * Return `{ status?, body }`: `body` is sent as the response, with `status`
   * or else `validation.response.status` (422 by default). Return `undefined`
   * to fall back to the global `validation.response.body` hook, then the
   * framework body. Wins over the global hook.
   *
   * Declare the body in the handler's `responseSchema` under the same status
   * so `warlock generate.openapi` documents it.
   *
   * @example
   * createImportController.validation = {
   *   schema: importSchema,
   *   onFailure: () => ({ status: 400, body: { error: "IMPORT_REQUEST_INVALID" } }),
   * };
   */
  onFailure?: ValidationFailureHandler<TRequest>;
};

/**
 * What a validation failure hook answers with.
 */
export type ValidationFailureResponse = {
  /**
   * Response status. Defaults to `validation.response.status` (422).
   */
  status?: number;
  /**
   * Response body, sent as JSON.
   */
  body: unknown;
};

/**
 * The second argument of a route's `validation.onFailure`.
 */
export type ValidationFailureContext<TRequest extends Request = Request> = {
  request: TRequest;
  response: Response;
  /**
   * The route whose validation failed.
   */
  route: Route;
};

/**
 * A route's `validation.onFailure` hook.
 */
export type ValidationFailureHandler<TRequest extends Request = Request> = (
  result: ValidationResult,
  context: ValidationFailureContext<TRequest>,
) =>
  | ValidationFailureResponse
  | undefined
  | void
  | Promise<ValidationFailureResponse | undefined | void>;

export interface RequestControllerContract {
  /**
   * Request object
   */
  request: Request;
  /**
   * Response object
   */
  response: Response;
  /**
   * Request Handler execution
   */
  execute(): Promise<ReturnedResponse>;
  /**
   * Request description
   */
  description?: string;
  /**
   * Request validation middleware
   */
  middleware?: () => Promise<MiddlewareResponse> | MiddlewareResponse;
}

/**
 * The single context object a route handler receives.
 *
 * v5 handlers are written `async ({ request, response }) => …` — one
 * parameter, destructured at the call site, replacing the v4 positional
 * `(request, response)` pair.
 */
export type HttpContext<TRequest extends Request = Request> = {
  /**
   * Request object
   */
  request: TRequest;
  /**
   * Response object
   */
  response: Response;
};

export type RequestHandler<TRequest extends Request = Request> = {
  /**
   * Function Declaration
   */
  (context: HttpContext<TRequest>): ReturnedResponse | void;

  /**
   * Validation static object property which can be optional
   */
  validation?: RequestHandlerValidation<TRequest>;

  /**
   * Request Handler Description
   */
  description?: string;

  /**
   * Response schema for documentation / OpenAPI generation.
   * Keyed by HTTP status code. Each entry declares the expected response body shape.
   */
  responseSchema?: ResponseSchema;
};

/**
 * A route's own rate limit: its own bucket and quota instead of the global
 * `http.rateLimit` policy.
 */
export type RouteRateLimitOptions = {
  /**
   * Max number of requests within the time window
   */
  max: number;
  /**
   * Time window in milliseconds
   */
  timeWindow: number;
  /**
   * Error message when rate limit is exceeded
   */
  errorMessage?: string;
};

/**
 * Options for a static mount: `router.directory()`, `router.file()`,
 * `router.cachedFile()`, `router.files()` and `router.cachedFiles()`.
 */
export type StaticMountOptions = {
  /**
   * How the rate limiter treats this mount. Leave it unset to follow
   * `http.rateLimit.staticFiles` (exempt by default); `true` counts the
   * mount against the global limiter, `false` exempts it, and an object
   * gives it its own limit and bucket.
   */
  rateLimit?: RouteRateLimitOptions | boolean;
};

export interface RouteOptions {
  /**
   * Route middleware
   */
  middleware?: Middleware[];
  /**
   * Middleware precedence to be applied before grouped middleware or after it
   */
  middlewarePrecedence?: "before" | "after";
  /**
   * Route name
   */
  name?: string;
  /**
   * Route description
   * Could be used for generating documentation
   */
  description?: string;
  /**
   * Fastify route options, forwarded to the route's registration.
   *
   * **Dev server caveat.** The dev server registers wildcard routes and
   * dispatches per request, so it has no per-route registration slot. It
   * forwards the pre-handler hook phases — `onRequest`, `preValidation` and
   * `preHandler` — by matching in Fastify's own `onRequest` phase and running
   * the matched route's hooks there, which keeps `onRequest` running before the
   * body is parsed, as it does in production.
   *
   * **Two things are NOT forwarded in dev, and cannot be:**
   * - `bodyLimit` — Fastify reads it at registration time; no hook can bound a
   *   body that is already being parsed.
   * - `preParsing` — it must return the payload stream, so forwarding it
   *   generically would corrupt the body rather than guard it.
   *
   * A route that relies on either of those behaves differently in dev than in
   * production. For a pre-parse guarantee that holds in both modes, register a
   * server-level hook through `router.beforeScanning((_router, server) =>
   * server.addHook("onRequest", ...))` — it lands on the Fastify instance
   * rather than in per-route options. That hook fires for **every** request, so
   * it must discriminate on `request.method` and `request.url` itself, and it
   * must be **idempotent per request**: `beforeScanning` runs once per scan and
   * restarting the HTTP connector builds a new server, so the callback can run
   * more than once against different instances.
   */
  serverOptions?: RouteShorthandOptions;
  /**
   * Set route label
   * Will be used for generating documentation
   * If not set, then Warlock will try to generate a label from the route path
   */
  label?: string;
  /**
   * Whether it is part of restful routes
   */
  restful?: boolean;
  /**
   * Mark this route as a page route that will be handled by React SSR
   */
  isPage?: boolean;
  /**
   * Let this GET route answer core-level refusals (a path-traversal 403 on the
   * public mount, a malformed-URL 400) for requests that accept HTML. The route
   * handler reads the refused status with `refusalStatusOf(request)`. Used by the
   * web page host's catch-all; API routes never set it.
   */
  handlesRefusals?: boolean;
  /**
   * How the rate limiter treats this route.
   *
   * - an object: the route gets its own limit and bucket instead of the
   *   global `http.rateLimit` policy;
   * - `false`: the route is exempt from the global limiter (development and
   *   production alike);
   * - `true`: the route stays under the global limiter. This is the default
   *   for application routes; it puts a `router.file()` route back under the
   *   global limiter when static files are exempt.
   *
   * @example
   * router.post("/login", login, { rateLimit: { max: 5, timeWindow: 60_000 } });
   * router.get("/webhooks/status", status, { rateLimit: false });
   */
  rateLimit?: RouteRateLimitOptions | boolean;
  /**
   * Opt this route OUT of the default core CSRF-Origin guard
   * (`../http/csrf-default-guard.ts`, SECURITY card 8a752ab2) by passing
   * `{ csrf: false }`. Any other value, including leaving it unset, keeps the
   * route in scope — there is no way to opt IN beyond the default.
   *
   * ⚠️ DANGEROUS. The guard is what stops a cookie-authenticated write
   * (any unsafe-method request carrying a non-`locale` cookie) reached
   * cross-site from succeeding without a same-origin/allowed `Origin` or
   * `Referer`. Exempting a route removes that protection for it alone —
   * reach for this ONLY for routes that cannot present a same-origin
   * `Origin`/`Referer` by construction and are safe without it:
   * - a third-party callback the browser is redirected to directly
   *   (an OAuth `/oauth/callback`, a payment-provider webhook UI redirect);
   * - a machine-to-machine route no browser ever calls with cookies.
   *
   * Never exempt a route an ordinary signed-in browser session POSTs/PUTs/
   * PATCHes/DELETEs to.
   *
   * @example
   * router.post("/oauth/callback", handler, { csrf: false });
   */
  csrf?: false;
  /**
   * Route-level validation, merged over the handler's own `validation`
   * (keys set here win). Lets one handler serve several routes with different
   * schemas or failure responses.
   *
   * @example
   * router.post("/workspace-import", importWorkspace, {
   *   validation: {
   *     schema: importWorkspaceSchema,
   *     onFailure: () => ({ status: 400, body: { error: "IMPORT_REQUEST_INVALID" } }),
   *   },
   * });
   */
  validation?: RequestHandlerValidation;
  /**
   * What this route's request log entries carry of its input, overriding
   * `http.logging`. Applied before any entry is built, so an omitted body or
   * query never reaches a log channel.
   *
   * @example
   * router.post("/accounts/credentials", controller, {
   *   logging: { body: false, query: false },
   * });
   */
  logging?: RequestLoggingOptions;
  /**
   * Declare a mutating route (POST/PUT/PATCH/DELETE) intentionally reachable
   * without signing in — a login, a webhook, a contact form. It changes
   * nothing at runtime; it records the decision so `warlock dev` and
   * `warlock check` (`WL9006`) stop reporting that the route has no auth
   * middleware. A group's `public: true` applies to every route
   * registered inside it. `warlock make endpoint --public` writes it.
   *
   * @example
   * router.post("/auth/login", loginController, { public: true });
   */
  public?: boolean;
  /**
   * Whether this named API route may be embedded in a page for browser use.
   *
   * Defaults to `true`. Set `false` for an endpoint that must never be
   * reachable through `apiHref()` or `useSubmitForm({ route })` from client
   * code (an internal webhook, an admin-only job trigger). Such a route is never
   * written into any page's browser route table, and a client reference to its
   * name is a `warlock check` error (`WL9020`). Server-side authorization still
   * decides who may call the endpoint.
   *
   * @example
   * router.post("/internal/reindex", reindexController, { name: "internal.reindex", clientVisible: false });
   */
  clientVisible?: boolean;
  /**
   * The sites (`web.sites` keys) a multi-site app offers this named API route
   * to in the browser. Absent means the route is shared: every site may embed
   * it. A route registered inside a `router.group({ sites })` inherits the
   * group's list unless it declares its own. This scopes browser route tables
   * only; the endpoint itself still answers on every host.
   *
   * @example
   * router.post("/api/admin/users", createUser, { name: "admin.users.create", sites: ["admin"] });
   */
  sites?: readonly string[];
}

export type RequestMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD"
  | "all";

/** Browser-safe snapshot metadata for a named application API route. */
export type NamedApiRoute = Readonly<{
  name: string;
  path: string;
  method: RequestMethod;
  /**
   * TypeScript type expression of the response body per status code, present only when the
   * route handler declares `responseSchema`. Self-contained: it references `CastOutput` and
   * `ResourceOutput` from `@warlock.js/core`, `typeof import(...)` of resource modules
   * (paths relative to `.warlock/typings/`), object literal types and arrays.
   */
  response?: Readonly<Record<string, string>>;
  /**
   * Present only as `false`, and only on a route that opted out with
   * `clientVisible: false`. Absent means the route may be embedded in pages.
   */
  clientVisible?: false;
  /** The route's declared `sites`, present only when it declared some. */
  sites?: readonly string[];
  /**
   * Present only as `true`: a required auth guard (see `markAuthGuard`) is in
   * the route's middleware chain, group middleware included. Browser tables
   * leave such a route out for guest viewers.
   */
  guarded?: true;
}>;

/** Options for `router.getNamedApiRoutes()`. */
export type NamedApiRoutesOptions = Readonly<{
  /**
   * Describe the response types of a route that declares `responseSchema`.
   * Returning `undefined` (or an empty record) leaves the route without a `response` key.
   */
  resolveResponse?: (
    schema: ResponseSchema,
    route: Route,
  ) => Readonly<Record<string, string>> | undefined;
}>;

/**
 * Route Object
 */
export type Route = RouteOptions & {
  /**
   * Route method
   */
  method: RequestMethod;
  /**
   * Route source file (Relative path)
   */
  sourceFile: string;
  /**
   * Route path
   */
  path: string;
  /**
   * Route handler Can be a function
   * And als can have a `validation` object as a static property of the handler
   */
  handler: RequestHandler;
  /**
   * Path prefix
   * Kindly note the prefix is auto added by the router and it should be added to the path itself
   * this will be used for generating the documentation
   */
  $prefix: string;
  /**
   * Path prefix Stack
   * Kindly note the prefix is auto added by the router and it should be added to the path itself
   * this will be used for generating the documentation
   */
  $prefixStack: string[];
  /**
   * Rate limit
   */
  rateLimit?: RouteOptions["rateLimit"];
  /**
   * Set by `router.file()`, `router.cachedFile()`, `router.files()` and
   * `router.cachedFiles()`: the route serves a static file, so it follows
   * `http.rateLimit.staticFiles` unless it sets `rateLimit` itself.
   */
  $staticFile?: boolean;
};

export type PartialPick<T, F extends keyof T> = Omit<T, F> & Partial<Pick<T, F>>;

/**
 * Grouped routes options
 */
export type GroupedRoutesOptions = {
  /**
   * Middlewares to be applied to all routes
   */
  middleware?: Middleware[];
  /**
   * Route prefix
   */
  prefix?: string;
  /**
   * Route name
   * This will be added to each route as a name prefix
   */
  name?: string;
  /**
   * Mark every route in the group as intentionally reachable without
   * signing in (see `RouteOptions.public`). A route's own `public: false`
   * opts it back out.
   */
  public?: boolean;
  /**
   * Offer every named API route in the group only to these sites (see
   * `RouteOptions.sites`). A route's own `sites` replaces it.
   */
  sites?: readonly string[];
};

/** Route resource */
export type RouteResource = {
  /**
   * list route
   */
  list?: RequestHandler;
  /**
   * Single resource route
   */
  get?: RequestHandler;
  /**
   * Create resource route
   */
  create?: RequestHandler;
  /**
   * Update resource route
   */
  update?: RequestHandler;
  /**
   * Patch resource route
   */
  patch?: RequestHandler;
  /**
   * Delete resource route
   */
  delete?: RequestHandler;
  /**
   * Delete Multiple Records
   */
  bulkDelete?: RequestHandler;
  /**
   * Validation object
   */
  validation?: {
    /**
     * Apply validation on create|update|patch combined
     */
    all?: RequestHandlerValidation<any>;
    /**
     * Create validation object
     */
    create?: RequestHandlerValidation<any>;
    /**
     * Update validation object
     */
    update?: RequestHandlerValidation<any>;
    /**
     * Patch validation object
     */
    patch?: RequestHandlerValidation<any>;
  };
};

export type RouterStacks = {
  prefix: string[];
  name: string[];
  middleware: Middleware[];
  /**
   * Open `router.group({ public: true })` scopes; routes registered while any
   * is open default to `public: true`.
   */
  public?: number;
  /** Open `router.group({ sites })` scopes, innermost last. */
  sites?: (readonly string[])[];
  /**
   * Source file path for routes being added (for HMR route tracking)
   */
  sourceFile?: string;
};
