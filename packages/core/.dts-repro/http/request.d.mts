import { UploadedFile } from "./uploaded-file.mjs";
import { Response } from "./response.mjs";
import { RequestEvent } from "./types.mjs";
import { Middleware, RequestHandler, Route } from "../router/types.mjs";
import { BaseValidator } from "@warlock.js/seal";
import { trans } from "@mongez/localization";
import { LogLevel } from "@warlock.js/logger";
import { FastifyRequest } from "fastify";
import { IncomingHttpHeaders } from "node:http2";

//#region ../../@warlock.js/core/src/http/request.d.ts
type StandardHeaders = { [K in keyof IncomingHttpHeaders as string extends K ? never : number extends K ? never : K]: IncomingHttpHeaders[K] };
type HeaderKeys = keyof StandardHeaders;
declare class Request<RequestValidation = any> {
  /**
   * Underlying Fastify request — a public escape hatch to capabilities the
   * framework's high-level helpers don't yet cover.
   *
   * **Prefer framework methods first**: `request.input()`, `request.header()`,
   * `request.body`, `request.query`, `request.params`, `request.file()`,
   * `request.user`, `request.detectIp()`, etc. They handle locale, parsing,
   * trust-proxy, and validation pipeline integration correctly.
   *
   * **Reach for `baseRequest` only** when the framework genuinely lacks a
   * helper for what you need — and when you do, file an issue so we can add
   * it. The escape hatch is the release valve that lets consumers move
   * faster than the framework, but every long-term reach here is a missing
   * helper waiting to be added.
   */
  baseRequest: FastifyRequest;
  /**
   * Response Object
   */
  response: Response;
  /**
   * Route Object
   */
  route: Route;
  /**
   * Parsed Request Payload
   */
  protected payload: any;
  /**
   * Decoded access token payload (set by auth middleware)
   */
  decodedAccessToken?: any;
  /**
   * Current request instance
   */
  static current: Request;
  /**
   * Translation method
   * Type of it is the same as the type of trans function
   */
  trans: ReturnType<typeof trans>;
  /**
   * Alias to trans method
   */
  t: ReturnType<typeof trans>;
  /**
   * Dynamic properties index signature
   *
   * This allows attaching custom properties to the request instance,
   * commonly used during validation middleware to attach fetched models.
   *
   * @example
   * // In validation middleware:
   * const post = await Post.find(request.int("id"));
   * if (!post) return response.notFound();
   * request.post = post; // Attach the model to the request
   *
   * // In route handler:
   * const post = request.post;
   * // Work with the pre-fetched model
   */
  [key: string]: any;
  /**
   * Locale code
   */
  protected _locale: string;
  /**
   * Validated data
   */
  protected validatedData?: RequestValidation;
  /**
   * Request id
   */
  id: string;
  /**
   * Start Time
   */
  startTime: number;
  /**
   * End Time
   */
  endTime?: undefined | number;
  /**
   * Set request handler
   */
  setRequest(request: FastifyRequest): this;
  /**
   * Inherit `X-Request-Id` from the incoming request, fall back to a custom
   * generator, then to the field-init default (`Random.string(32)`).
   *
   * Inherited values are validated (length cap + printable-ASCII) to prevent
   * log-injection from a malicious client. Disable the whole behavior by
   * setting `http.requestId.enabled = false` — in which case the field-init
   * default is used regardless of any incoming header.
   */
  protected resolveRequestId(): void;
  /**
   * Validate a candidate request-id value. Accepts non-empty printable ASCII
   * up to 128 characters — tight enough to reject newline / control-character
   * log-injection, loose enough to accept UUIDs, ULIDs, snowflakes, etc.
   */
  protected static isValidRequestId(value: unknown): value is string;
  /**
   * Translate from the given locale code
   */
  transFrom(localeCode: string, keyword: string, placeholders?: any): any;
  /**
   * Get current locale code
   */
  get locale(): string;
  /**
   * Set locale code
   */
  set locale(localeCode: string);
  /**
   * Get locale code that will be used for translation
   */
  get localized(): any;
  /**
   * Set locale code
   */
  setLocaleCode(localeCode: string): this;
  /**
   * Get current locale code or return default locale code
   */
  getLocaleCode(defaultLocaleCode?: string): string;
  /**
   * Get http protocol
   */
  get protocol(): "http" | "https";
  /**
   * Validate the given validation schema
   */
  validate(validation: BaseValidator, selectedInputs?: string[]): Promise<any>;
  /**
   * Clear current user
   */
  clearCurrentUser(): void;
  /**
   * Get value of the given header
   */
  header<TCustomHeader extends string = HeaderKeys>(name: TCustomHeader | HeaderKeys, defaultValue?: any): any;
  /**
   * Get all cookies from the current request
   */
  get cookies(): Record<string, string | undefined>;
  /**
   * Get a particular cookie value or fallback to default
   */
  cookie(name: string, defaultValue?: any): string | any;
  /**
   * Determine if the request has the specified cookie
   */
  hasCookie(name: string): boolean;
  /**
   * Get the current request domain
   */
  get domain(): string;
  /**
   * Get hostname
   */
  get hostname(): string;
  /**
   * Get request origin
   */
  get origin(): string;
  /**
   * Get the domain of the origin
   */
  get originDomain(): string | null;
  /**
   * Get authorization header value
   */
  get authorizationValue(): string;
  /**
   * Get access token from Authorization header
   *
   * If the Authorization header does not start with `Bearer` value then return null
   */
  get accessToken(): string | undefined;
  /**
   * Get the authorization header
   */
  get authorization(): any;
  /**
   * Get current request method
   */
  get method(): string;
  /**
   * Parse the payload and merge it from the request body, params and query string
   */
  protected parsePayload(): void;
  /**
   * Parse body payload
   */
  protected parseBody(data: any): any;
  /**
   * Parse the given data
   */
  protected parseValue(data: any): any;
  /**
   * Set route handler
   */
  setRoute(route: Route): this;
  /**
   * Trigger an http event
   */
  trigger(eventName: RequestEvent, ...args: any[]): any;
  /**
   * Listen to the given event
   */
  on(eventName: RequestEvent, callback: any): any;
  /**
   * Make a log message
   */
  log(message: any, level?: LogLevel): void;
  /**
   * Get current request path
   */
  get path(): string;
  /**
   * {@alias}
   */
  get url(): string;
  /**
   * Get full url
   */
  get fullUrl(): string;
  /**
   * Drive the middleware chain for the current route, then defer to the
   * controller. Returns the first response value any middleware short-circuits
   * with, or `undefined` to continue into validation + handler.
   *
   * @internal Framework orchestration — do not call from app code. Will move
   * to a dedicated controller dispatcher in a future refactor.
   */
  runMiddleware(): Promise<any[] | Record<string, any> | Response | undefined>;
  /**
   * Return the request handler attached to the current route.
   *
   * @internal Framework orchestration — do not call from app code.
   */
  getHandler(): RequestHandler<Request<any>>;
  /**
   * Get inputs that has been validated only
   * You can also pass an array of inputs to get only the validated inputs
   */
  validated<Output = RequestValidation>(inputs?: (keyof Output | (string & {}))[]): Output;
  /**
   * Get inputs that has been validated except the given inputs
   */
  validatedExcept(...inputs: string[]): RequestValidation;
  /**
   * Set validated data
   */
  setValidatedData(data: RequestValidation): void;
  /**
   * Top-level entry into the request lifecycle — opens the context store,
   * runs middleware, drives the handler, handles errors.
   *
   * @internal Framework orchestration — do not call from app code. Wired
   * from the Fastify route handler in `router.scan()`.
   */
  execute(): Promise<any[] | Record<string, any> | Response>;
  /**
   * Iterate the collected middlewares in order; return the first short-circuit
   * value or `undefined` when every middleware passes through.
   *
   * @internal Framework orchestration — do not call from app code.
   */
  protected executeMiddleware(): Promise<any[] | Record<string, any> | Response | undefined>;
  /**
   * Gather the middleware list for the current route — today just the
   * route-level array; future extraction may merge group + app-wide layers.
   *
   * @internal Framework orchestration — do not call from app code.
   */
  protected collectMiddlewares(): Middleware[];
  /**
   * Get request input value from query string, params or body
   */
  input(key: string, defaultValue?: any): any;
  /**
   * Get email input value, this will lowercase the value
   */
  email(key?: string, defaultValue?: string): string;
  /**
   * @alias input
   */
  get(key: string, defaultValue?: any): any;
  /**
   * Determine if request has input value
   */
  has(key: string): boolean;
  /**
   * Set request input value
   */
  set(key: string, value: any): this;
  /**
   * Set the given value if the request does not have the input
   */
  setDefault(key: string, value: any): this;
  /**
   * Unset request payload keys
   */
  unset(...keys: string[]): this;
  /**
   * Get request body
   */
  get body(): any;
  /**
   * Set request body value
   */
  setBody(key: string, value: any): this;
  /**
   * Get body inputs except files
   */
  get bodyInputs(): any;
  /**
   * Get request file in UploadedFile instance
   */
  file(key: string): UploadedFile | undefined;
  /**
   * Get uploaded files from the request for the given name
   * If the given name is not present in the request, return an empty array
   */
  files(name: string): UploadedFile[];
  /**
   * Get request params
   */
  get params(): any;
  /**
   * Set request params value
   */
  setParam(key: string, value: any): this;
  /**
   * Get request query
   */
  get query(): any;
  /**
   * Set request query value
   */
  setQuery(key: string, value: any): this;
  /**
   * Get all inputs
   */
  all(): any;
  /**
   * Get all inputs except params
   */
  allExceptParams(): any;
  /**
   * Get all heavy inputs except params
   */
  heavyExceptParams(): any;
  /**
   * Get only heavy inputs, the input with a value
   */
  heavy(): any;
  /**
   * Get only the given keys from the request data
   */
  only(keys: string[]): any;
  /**
   * Pluck the given keys from the request data
   */
  pluck(keys: string[]): any;
  /**
   * Get all request inputs except the given keys
   */
  except(keys: string[]): any;
  /**
   * Get boolean input value
   */
  bool(key: string, defaultValue?: boolean): boolean;
  /**
   * Get integer input value
   */
  int(key: string, defaultValue?: number): number | undefined;
  /**
   * Shorthand getter to get id param
   */
  get idParam(): number | undefined;
  /**
   * Get string input value
   */
  string(key: string, defaultValue?: string): string;
  /**
   * Get float input value
   */
  float(key: string, defaultValue?: number): number;
  /**
   * Get number input value
   */
  number(key: string, defaultValue?: number): number;
  /**
   * Immediate-peer IP as Fastify reports it — the address that connected to
   * the server socket, with `trustProxy` resolution applied. Use this when
   * you specifically need the peer address (rate-limit-by-direct-connection,
   * health-check origin verification).
   *
   * **For most use cases prefer `request.detectIp()`** — behind any proxy
   * (load balancer, CDN, sidecar) `ip` reports the proxy, not the real client.
   */
  get ip(): string;
  /**
   * Best-effort real client IP — checks `X-Real-IP` and `X-Forwarded-For`
   * headers first, falls back to `baseRequest.ip` when neither is present.
   *
   * **Prefer this over `request.ip` for any caller behind a proxy** (load
   * balancer, CDN, reverse proxy, k8s ingress). Only trust the result as
   * far as you trust the upstream proxy chain — `X-Forwarded-For` is
   * client-settable; verify the request came through your trusted edge
   * before treating the value as authoritative.
   */
  detectIp(): any;
  /**
   * An alias to detectIp
   */
  get realIp(): any;
  /**
   * Get request ips
   */
  get ips(): string[] | undefined;
  /**
   * Get request referer
   */
  get referer(): string | undefined;
  /**
   * Get user agent
   */
  get userAgent(): string | undefined;
  /**
   * Get request headers
   */
  get headers(): typeof this.baseRequest.headers;
  /**
   * Set the given header
   */
  setHeader(key: HeaderKeys, value: string): this;
}
//#endregion
export { Request };
//# sourceMappingURL=request.d.mts.map