import { colors } from "@mongez/copper";
import events from "@mongez/events";
import { trans, transFrom } from "@mongez/localization";
import { Random, except, get, only, rtrim, set, unset } from "@mongez/reinforcements";
import { isEmpty } from "@mongez/supportive-is";
import type { LogLevel } from "@warlock.js/logger";
import { log } from "@warlock.js/logger";
import { BaseValidator, v } from "@warlock.js/seal";
import type { FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { type IncomingHttpHeaders } from "node:http2";
import { config } from "../config/config-getter";
import { resolveLocaleConfiguration } from "../config/locale-configuration";
import type { Middleware, Route } from "../router";
import { validateAll } from "../validation/validateAll";
import { createRequestStore } from "./middleware/inject-request-context";
import { Response } from "./response";
import type { RequestEvent, RequestLocals, RequestUser } from "./types";
import { UploadedFile } from "./uploaded-file";

type StandardHeaders = {
  // copy every declared property from http.IncomingHttpHeaders
  // but remove index signatures
  [K in keyof IncomingHttpHeaders as string extends K
    ? never
    : number extends K
      ? never
      : K]: IncomingHttpHeaders[K];
};

type HeaderKeys = keyof StandardHeaders;

export class Request<RequestValidation = any> {
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
  public baseRequest!: FastifyRequest;

  /**
   * Response Object
   */
  public response!: Response;

  /**
   * Route Object
   */
  public route!: Route;

  /**
   * Parsed Request Payload
   */
  protected payload: any = {};

  /**
   * Decoded access token payload (set by auth middleware)
   */
  public decodedAccessToken?: any;

  /**
   * The authenticated user attached to this request, if any.
   *
   * `RequestUser` is empty by default, so ANY shape is assignable here at the
   * declaration site — the app or auth package declares its real fields via
   * module augmentation:
   *
   * ```typescript
   * declare module "@warlock.js/core" {
   *   interface RequestUser {
   *     id: string | number;
   *   }
   * }
   * ```
   *
   * Replaces the v4 `GuardedRequest` convention
   * (`create-warlock/.../guarded.request.ts` — `Request<T> & { user: User }`,
   * an intersection type hand-declared per app) with a property core itself
   * declares and types. `clearCurrentUser()` below is the one place core
   * writes it directly; auth middleware is expected to do the same after a
   * successful token resolution.
   */
  public user?: RequestUser;

  /**
   * Private, server-only, per-request data bag.
   *
   * Distinct from the input payload (`body` / `query` / `params` / `all()`):
   * a write here never surfaces in `request.all()`, `request.validated()`, or
   * `request.input()`. That is the trap `request.set()` sets for private data
   * — it writes into the payload `all` bag, so anything stored there leaks
   * into every input accessor and, from there, into the client-facing
   * payload. `locals` is the correct home for private per-request app data
   * (a resolved session, a fetched-once model) that must never be mistaken
   * for client input.
   *
   * Augmentable via module augmentation, in the module that OWNS the key:
   *
   * ```typescript
   * declare module "@warlock.js/core" {
   *   interface RequestLocals {
   *     session?: { token: string };
   *   }
   * }
   * ```
   *
   * A plain class-field initializer is sufficient for "fresh per request":
   * `router.ts:925` constructs `new Request()` for every incoming request —
   * `Request` instances are not pooled or reused across requests — so this
   * initializer runs exactly once per request and no value can leak in from
   * a prior one.
   */
  public locals: RequestLocals = {};

  /**
   * Backing field for the lazily-generated CSP nonce. Left `undefined` until
   * the first `request.nonce` read; see the `nonce` getter below.
   */
  protected _nonce?: string;

  /**
   * Per-request Content-Security-Policy nonce — a fresh, unguessable value
   * the web layer hands to `<Scripts nonce={...} />` (the inline payload
   * script) and to the `Content-Security-Policy` header, so a strict
   * `script-src 'nonce-...'` allows only the script this request actually
   * rendered.
   *
   * Generated LAZILY on first access, not eagerly in `setRequest()`: most
   * requests (API routes, anything that isn't rendering HTML) never read it,
   * and spending a `randomBytes` call on every single request for a value
   * most of them discard is wasted entropy draw + CPU. Once generated it is
   * cached in `_nonce`, so every subsequent read within the SAME request
   * returns the identical value — required, since the header and the inline
   * `<script>` tag must agree on one nonce. `_nonce` is a plain field on a
   * per-request `Request` instance (see `locals` above — `router.ts:925`,
   * no pooling), so the cache can never leak into the next request; a fresh
   * `Request` means a fresh, unset `_nonce`.
   *
   * 16 random bytes, base64-encoded — the size the CSP Level 3 spec's own
   * examples use, and far more entropy than an attacker could feasibly guess
   * to defeat the policy.
   */
  public get nonce(): string {
    if (!this._nonce) {
      this._nonce = randomBytes(16).toString("base64");
    }

    return this._nonce;
  }

  /**
   * Current request instance
   */
  public static current: Request;

  /**
   * Translation method
   * Type of it is the same as the type of trans function
   */
  public trans: ReturnType<typeof trans> = trans;

  /**
   * Alias to trans method
   */
  public t: ReturnType<typeof trans> = trans;

  /*
   * v5 removed the `[key: string]: any` index signature (eed20184). Attaching
   * arbitrary properties compiled silently and hid real bugs behind `any`.
   * The sanctioned extension paths are:
   * - `request.locals` (augment `RequestLocals` via module augmentation) for
   *   per-request attached data, e.g. models fetched in validation middleware.
   * - `requestMemo(key, fn)` for per-request memoized computation.
   * - Module augmentation of the `Request` class itself for new typed members.
   */

  /**
   * Locale code
   */
  protected _locale = "";

  /**
   * Validated data
   */
  protected validatedData?: RequestValidation;

  /**
   * Request id
   */
  public id = Random.string(32);

  /**
   * Start Time
   */
  public startTime = Date.now();

  /**
   * End Time
   */
  public endTime?: undefined | number;

  /**
   * Set request handler
   */
  public setRequest(request: FastifyRequest) {
    this.baseRequest = request;

    this.resolveRequestId();

    this.parsePayload();

    // Resolve the locale at CALL time, never at bind time. `setRequest` runs
    // before routing, so a locale set later (path locale, `setLocaleCode`, the
    // web layer's C3 derivation) must steer translations too — the old
    // `transFrom.bind(null, localeCode)` snapshot made `request.locale` and
    // `request.trans()` silently disagree for the rest of the request.
    this.trans = this.t = (keyword: string, placeholders?: any) =>
      transFrom(this.getLocaleCode(), keyword, placeholders);

    return this;
  }

  /**
   * Inherit `X-Request-Id` from the incoming request, fall back to a custom
   * generator, then to the field-init default (`Random.string(32)`).
   *
   * Inherited values are validated (length cap + printable-ASCII) to prevent
   * log-injection from a malicious client. Disable the whole behavior by
   * setting `http.requestId.enabled = false` — in which case the field-init
   * default is used regardless of any incoming header.
   */
  protected resolveRequestId() {
    const requestIdConfig = config.key("http.requestId") || {};

    if (requestIdConfig.enabled === false) return;

    const headerName = (requestIdConfig.header || "x-request-id").toLowerCase();
    const incoming = this.baseRequest.headers[headerName];

    if (Request.isValidRequestId(incoming)) {
      this.id = incoming;

      return;
    }

    if (typeof requestIdConfig.generator === "function") {
      this.id = requestIdConfig.generator();
    }
  }

  /**
   * Validate a candidate request-id value. Accepts non-empty printable ASCII
   * up to 128 characters — tight enough to reject newline / control-character
   * log-injection, loose enough to accept UUIDs, ULIDs, snowflakes, etc.
   */
  protected static isValidRequestId(value: unknown): value is string {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 128 &&
      /^[\x21-\x7e]+$/.test(value)
    );
  }

  /**
   * Translate from the given locale code
   */
  public transFrom(localeCode: string, keyword: string, placeholders?: any) {
    return transFrom(localeCode, keyword, placeholders);
  }

  /**
   * Cache one supported locale without coercing request-controlled input.
   */
  protected cacheLocale(candidate: unknown): string {
    const localeConfiguration = resolveLocaleConfiguration(
      config.key("app.localeCode"),
      config.key("app.localeCodes"),
    );
    const acceptedLocale =
      typeof candidate === "string" &&
      candidate.length > 0 &&
      localeConfiguration.localeCodes.includes(candidate)
        ? candidate
        : localeConfiguration.defaultLocaleCode;

    this._locale = acceptedLocale;

    return this._locale;
  }

  /**
   * Resolve the first present Mode B source. Unsupported values fail closed to
   * the configured default instead of widening the application's locale set.
   */
  protected resolveLocale(): string {
    const candidate = [
      this.query["locale"],
      this.cookies["locale"],
      this.header("locale"),
    ].find((value) => typeof value === "string" && value.length > 0);

    return this.cacheLocale(candidate);
  }

  /**
   * Get current locale code
   */
  public get locale(): string {
    if (this._locale) return this._locale;

    return this.resolveLocale();
  }

  /**
   * Set locale code
   */
  public set locale(localeCode: string) {
    this.cacheLocale(localeCode);
  }

  /**
   * Set locale code
   */
  public setLocaleCode(localeCode: string) {
    this.locale = localeCode;

    return this;
  }

  /**
   * @deprecated Use `request.locale`. This alias is removed after one version.
   * The legacy default argument is accepted for source compatibility but the
   * resolved default is owned exclusively by app configuration.
   */
  public getLocaleCode(_legacyDefaultLocaleCode?: string): string {
    return this.locale;
  }

  /**
   * Get http protocol
   */
  public get protocol() {
    return this.baseRequest.protocol;
  }

  /**
   * Validate the given validation schema
   */
  public async validate(validation: BaseValidator, selectedInputs?: string[]) {
    return await v.validate(validation, selectedInputs ? this.only(selectedInputs) : this.all());
  }

  /**
   * Get value of the given header
   */
  public header<TCustomHeader extends string = HeaderKeys>(
    name: TCustomHeader | HeaderKeys,
    defaultValue: any = null,
  ) {
    return this.baseRequest.headers[name.toLocaleLowerCase()] ?? defaultValue;
  }

  /**
   * Get all cookies from the current request
   */
  public get cookies(): Record<string, string | undefined> {
    return this.baseRequest.cookies || {};
  }

  /**
   * Get a particular cookie value or fallback to default
   */
  public cookie(name: string, defaultValue?: any): string | any {
    const value = this.cookies[name] ?? defaultValue;

    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  /**
   * Determine if the request has the specified cookie
   */
  public hasCookie(name: string): boolean {
    return this.cookies[name] !== undefined;
  }

  /**
   * Get the current request domain
   */
  public get domain() {
    return this.baseRequest.hostname.replace(/^www\./, "");
  }

  /**
   * Get hostname
   */
  public get hostname() {
    return this.domain;
  }

  /**
   * Get request origin
   */
  public get origin() {
    return this.baseRequest.headers.origin as string;
  }

  /**
   * Get the domain of the origin
   */
  public get originDomain() {
    const domain = this.origin ? new URL(this.origin).hostname : null;

    if (domain?.startsWith("www.")) {
      return domain.replace(/^www\./, "");
    }

    return domain;
  }

  /**
   * Get authorization header value
   */
  public get authorizationValue(): string {
    const authorization = this.header("authorization");

    if (!authorization) return "";

    const [type, value] = authorization.split(" ");

    if (!["bearer", "key"].includes(type.toLowerCase())) return "";

    return value || "";
  }

  /**
   * Get access token from Authorization header
   *
   * If the Authorization header does not start with `Bearer` value then return null
   */
  public get accessToken(): string | undefined {
    const authorization = this.header("authorization");

    if (!authorization) return;

    const [type, value] = authorization.split(" ");

    if (type.toLowerCase() !== "bearer") return;

    return value;
  }

  /**
   * Get the authorization header
   */
  public get authorization() {
    return this.header("authorization");
  }

  /**
   * Get current request method
   */
  public get method(): string {
    return this.baseRequest.method;
  }

  /**
   * Parse the payload and merge it from the request body, params and query string
   */
  protected parsePayload() {
    this.payload.body = this.parseBody(this.baseRequest.body);

    this.payload.query = this.parseBody(this.baseRequest.query);
    this.payload.params = { ...(this.baseRequest.params || {}) };
    this.payload.all = {
      ...this.payload.body,
      ...this.payload.query,
      ...this.payload.params,
    };
  }

  /**
   * Parse body payload
   */
  protected parseBody(data: any) {
    try {
      if (!data) return {};

      const body: any = {};

      const arrayOfObjectValues: any = {};

      for (let key in data) {
        const value = data[key];

        let isArrayKey = false;

        if (key.endsWith("[]")) {
          isArrayKey = true;
        }

        key = rtrim(key, "[]");

        // check if the key is has a square brackets, then convert it into object
        // i.e user[email] => user: {email: "value"}
        // also check if its an array of objects

        if (key.includes("[")) {
          // check if its an array of objects
          if (key.includes("][")) {
            const keyParts = key.split("[");

            const keyName = keyParts[0];
            if (!arrayOfObjectValues[keyName]) {
              arrayOfObjectValues[keyName] = [];
            }

            const keyNameParts = keyParts[1].split("]");

            const index = Number(keyNameParts[0]);

            if (!arrayOfObjectValues[keyName][index]) {
              arrayOfObjectValues[keyName][index] = {};
            }

            // now get the key after the index
            const keyNameParts2 = keyParts[2].split("]");
            const keyName2 = keyNameParts2[0];

            arrayOfObjectValues[keyName][index][keyName2] = this.parseValue(value);

            continue;
          }

          const keyParts = key.split("[");
          const keyName = keyParts[0];
          const keyNameParts = keyParts[1].split("]");

          set(
            body,
            keyName + "." + keyNameParts[0],
            Array.isArray(value) ? value.map(this.parseValue.bind(this)) : this.parseValue(value),
          );

          continue;
        }

        if (Array.isArray(value)) {
          set(body, key, value.map(this.parseValue.bind(this)));
        } else if (isArrayKey) {
          if (body[key]) {
            body[key].push(this.parseValue(value));
          } else {
            body[key] = [this.parseValue(value)];

            continue;
          }
        } else {
          set(body, key, this.parseValue(value));
        }
      }

      // now merge the array of objects into the body
      for (const key in arrayOfObjectValues) {
        body[key] = arrayOfObjectValues[key];
      }

      return body;
    } catch (error) {
      console.log(error);
      this.log(error, "error");
    }
  }

  /**
   * Parse the given data
   */
  protected parseValue(data: any) {
    // data.value appears only in the multipart form data
    // if it json, then just return the data
    if (data?.file) return new UploadedFile(data);
    if (data?.value !== undefined && data?.fields && data?.type) {
      data = data.value;
    }

    if (data === "false") return false;

    if (data === "true") return true;

    if (data === "null") return null;

    if (typeof data === "string") return data.trim();

    return data;
  }

  /**
   * Set route handler
   */
  public setRoute(route: Route) {
    this.route = route;

    // pass the route to the response object
    this.response.setRoute(route);

    return this;
  }

  /**
   * Trigger an http event
   */
  public trigger(eventName: RequestEvent, ...args: any[]) {
    return events.trigger(`request.${eventName}`, ...args, this);
  }

  /**
   * Listen to the given event
   */
  public on(eventName: RequestEvent, callback: any) {
    return events.subscribe(`request.${eventName}`, callback);
  }

  /**
   * Make a log message
   */
  public log(message: any, level: LogLevel = "info") {
    if (!config.key("http.log")) return;

    log.log({
      module: "request",
      action: this.route.method + " " + this.route.path.replace("/*", "") + `:${this.id}`,
      message,
      type: level,
      context: {
        request: this,
      },
    });
  }

  /**
   * Get current request path
   */
  public get path() {
    return this.baseRequest.url;
  }

  /**
   * {@alias}
   */
  public get url() {
    return this.baseRequest.url;
  }

  /**
   * Get full url
   */
  public get fullUrl() {
    return this.protocol + "://" + this.hostname + this.path;
  }

  /**
   * Drive the middleware chain for the current route, then defer to the
   * controller. Returns the first response value any middleware short-circuits
   * with, or `undefined` to continue into validation + handler.
   *
   * @internal Framework orchestration — do not call from app code. Will move
   * to a dedicated controller dispatcher in a future refactor.
   */
  public async runMiddleware() {
    // measure request time
    // check for middleware first
    const middlewareOutput = await this.executeMiddleware();

    if (middlewareOutput !== undefined) {
      // 👇🏻 make sure first its not a response instance
      if (middlewareOutput instanceof Response) return middlewareOutput;
      // 👇🏻 send the response
      return this.response.send(middlewareOutput);
    }

    const handler = this.route.handler;

    if (!handler.validation) return;

    // 👇🏻 check for validation using validateAll helper function
    const validationOutput = await validateAll(handler.validation, this, this.response);

    return validationOutput;
  }

  /**
   * Return the request handler attached to the current route.
   *
   * @internal Framework orchestration — do not call from app code.
   */
  public getHandler() {
    return this.route.handler;
  }

  /**
   * Get inputs that has been validated only
   * You can also pass an array of inputs to get only the validated inputs
   */
  public validated<Output = RequestValidation>(inputs?: (keyof Output | (string & {}))[]): Output {
    if (this.validatedData) {
      return inputs
        ? only(this.validatedData as Output, inputs as string[])
        : (this.validatedData as Output);
    }

    return {} as Output;
  }

  /**
   * Get inputs that has been validated except the given inputs
   */
  public validatedExcept(...inputs: string[]): RequestValidation {
    return except(this.validated(), inputs);
  }

  /**
   * Set validated data
   */
  public setValidatedData(data: RequestValidation) {
    this.validatedData = data;
  }

  /**
   * Top-level entry into the request lifecycle — opens the context store,
   * runs middleware, drives the handler, handles errors.
   *
   * @internal Framework orchestration — do not call from app code. Wired
   * from the Fastify route handler in `router.scan()`.
   */
  public async execute() {
    try {
      // call executingAction event

      this.log("Executing the request");

      return await createRequestStore(this, this.response);
    } catch (error) {
      this.log(error, "error");

      throw error;
    }
  }

  /**
   * Iterate the collected middlewares in order; return the first short-circuit
   * value or `undefined` when every middleware passes through.
   *
   * @internal Framework orchestration — do not call from app code.
   */
  protected async executeMiddleware() {
    // collect all middlewares for current route
    const middlewares = this.collectMiddlewares();

    // check if there are no middlewares, then return
    if (middlewares.length === 0) return;

    this.log("About to execute request middlewares");

    // trigger the executingMiddleware event
    this.trigger("executingMiddleware", middlewares, this.route);

    for (const middleware of middlewares) {
      this.log("Executing middleware " + colors.yellowBright(middleware.name));
      const output = await middleware({ request: this, response: this.response });
      this.log("Executed middleware " + colors.yellowBright(middleware.name), "success");

      if (output !== undefined) {
        this.log(
          colors.yellow("request intercepted by middleware ") + colors.cyanBright(middleware.name),
          "warn",
        );

        this.trigger("executedMiddleware");

        this.log("Request middlewares executed", "success");

        return output;
      }
    }

    this.log("Request middlewares executed", "success");

    // trigger the executedMiddleware event
    this.trigger("executedMiddleware", middlewares, this.route);
  }

  /**
   * Gather the middleware list for the current route — today just the
   * route-level array; future extraction may merge group + app-wide layers.
   *
   * @internal Framework orchestration — do not call from app code.
   */
  protected collectMiddlewares(): Middleware[] {
    const middlewaresList: Middleware[] = [];

    // collect route middlewares
    if (this.route.middleware) {
      middlewaresList.push(...this.route.middleware);
    }

    return middlewaresList;
  }

  /**
   * Get request input value from query string, params or body
   */
  public input(key: string, defaultValue?: any) {
    return get(this.payload.all, key, defaultValue);
  }

  /**
   * Get email input value, this will lowercase the value
   */
  public email(key: string = "email", defaultValue: string = ""): string {
    return this.input(key, defaultValue)?.toLowerCase() || defaultValue;
  }

  /**
   * @alias input
   */
  public get(key: string, defaultValue?: any) {
    return this.input(key, defaultValue);
  }

  /**
   * Determine if request has input value
   */
  public has(key: string) {
    return get(this.payload.all, key, undefined) !== undefined;
  }

  /**
   * Set request input value
   */
  public set(key: string, value: any) {
    set(this.payload.all, key, value);

    return this;
  }

  /**
   * Set the given value if the request does not have the input
   */
  public setDefault(key: string, value: any) {
    if (this.has(key)) return this;

    set(this.payload.all, key, value);

    return this;
  }

  /**
   * Unset request payload keys
   */
  public unset(...keys: string[]) {
    this.payload.all = unset(this.payload.all, keys);

    return this;
  }

  /**
   * Get request body
   */
  public get body() {
    return this.payload.body;
  }

  /**
   * Set request body value
   */
  public setBody(key: string, value: any) {
    set(this.payload.body, key, value);

    return this;
  }

  /**
   * Get body inputs except files
   */
  public get bodyInputs() {
    const inputs = this.payload.body;

    const bodyInputs: any = {};

    for (const key in inputs) {
      const value = inputs[key];

      if (value.file && value.fieldname) continue;

      bodyInputs[key] = value;
    }

    return bodyInputs;
  }

  /**
   * Get request file in UploadedFile instance
   */
  public file(key: string): UploadedFile | undefined {
    const file = this.input(key);

    return file;
  }

  /**
   * Get uploaded files from the request for the given name
   * If the given name is not present in the request, return an empty array
   */
  public files(name: string): UploadedFile[] {
    return this.input(name) || [];
  }

  /**
   * Get request params
   */
  public get params() {
    return this.payload.params;
  }

  /**
   * Set request params value
   */
  public setParam(key: string, value: any) {
    set(this.payload.params, key, value);

    return this;
  }

  /**
   * Get request query
   */
  public get query() {
    return this.payload.query;
  }

  /**
   * Set request query value
   */
  public setQuery(key: string, value: any) {
    set(this.payload.query, key, value);

    return this;
  }

  /**
   * Get all inputs
   */
  public all() {
    return this.payload.all;
  }

  /**
   * Get all inputs except params
   */
  public allExceptParams() {
    return {
      ...this.payload.query,
      ...this.payload.body,
    };
  }

  /**
   * Get all heavy inputs except params
   */
  public heavyExceptParams() {
    const inputs = this.allExceptParams();

    const heavyInputs: any = {};

    for (const key in inputs) {
      const value = inputs[key];

      if (isEmpty(value) && value !== null) continue;

      heavyInputs[key] = value;
    }

    return heavyInputs;
  }

  /**
   * Get only heavy inputs, the input with a value
   */
  public heavy() {
    const inputs = this.all();

    const heavyInputs: any = {};

    for (const key in inputs) {
      const value = inputs[key];

      if (isEmpty(value) && value !== null) continue;

      heavyInputs[key] = value;
    }

    return heavyInputs;
  }

  /**
   * Get only the given keys from the request data
   */
  public only(keys: string[]) {
    return only(this.all(), keys);
  }

  /**
   * Pluck the given keys from the request data
   */
  public pluck(keys: string[]) {
    const data = this.only(keys);

    this.unset(...keys);

    return data;
  }

  /**
   * Get all request inputs except the given keys
   */
  public except(keys: string[]) {
    return except(this.all(), keys);
  }

  /**
   * Get boolean input value
   */
  public bool(key: string, defaultValue = false) {
    const value = this.input(key, defaultValue);

    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }

    if (value === 0) {
      return false;
    }

    return Boolean(value);
  }

  /**
   * Get integer input value
   */
  public int(key: string, defaultValue: number = 0): number | undefined {
    const value = this.input(key, defaultValue);

    if (!value && value !== 0) return undefined;

    return parseInt(value);
  }

  /**
   * Shorthand getter to get id param
   */
  public get idParam() {
    return this.int("id");
  }

  /**
   * Get string input value
   */
  public string(key: string, defaultValue: string = ""): string {
    const value = this.input(key, defaultValue);

    return String(value);
  }

  /**
   * Get float input value
   */
  public float(key: string, defaultValue: number = 0): number {
    const value = this.input(key, defaultValue);

    return parseFloat(value) || 0;
  }

  /**
   * Get number input value
   */
  public number(key: string, defaultValue: number = 0): number {
    const value = Number(this.input(key, defaultValue));

    return isNaN(value) ? defaultValue : value;
  }

  /**
   * Immediate-peer IP as Fastify reports it — the address that connected to
   * the server socket, with `trustProxy` resolution applied. Use this when
   * you specifically need the peer address (rate-limit-by-direct-connection,
   * health-check origin verification).
   *
   * **For most use cases prefer `request.detectIp()`** — behind any proxy
   * (load balancer, CDN, sidecar) `ip` reports the proxy, not the real client.
   */
  public get ip() {
    return this.baseRequest.ip;
  }

  /**
   * Best-effort real client IP — the value everything IP-scoped keys on
   * (ip-filter allowlists, rate-limit buckets, idempotency scoping).
   *
   * `X-Forwarded-For` resolution is **delegated to Fastify**: `baseRequest.ip`
   * is already the client address Fastify's `trustProxy` machinery picked out
   * of the chain, so every shape `http.trustProxy` accepts is honoured here
   * with exactly the semantics Fastify documents:
   *
   * - `false` (default) — no header is trusted; the socket peer address wins.
   *   Both forwarding headers are client-settable, so without a trusted edge
   *   that rewrites them any client could otherwise forge its own IP.
   * - `true` — the whole chain is trusted; the leftmost hop (original client)
   *   wins.
   * - `number` — that many rightmost hops are trusted, so an edge that
   *   APPENDS to `X-Forwarded-For` yields the real client rather than whatever
   *   the client prepended.
   * - CIDR / IP list (string, comma-separated string, or array) or a custom
   *   predicate — the chain is walked right-to-left and stops at the first hop
   *   that isn't a trusted proxy.
   *
   * `X-Real-IP` is NOT part of that resolution — Fastify never looks at it,
   * and unlike `X-Forwarded-For` it carries no chain, so there is nothing to
   * validate a hop count or proxy allowlist against. It is therefore honoured
   * only under `trustProxy: true` ("everything upstream is mine"), where it is
   * no weaker than the trust already granted. Under a bounded `trustProxy`
   * (hop count / CIDR list) it is ignored: a trusted-but-passthrough edge that
   * forwards the client's own `X-Real-IP` verbatim would otherwise hand any
   * client a way around the bound.
   *
   * **Prefer this over `request.ip` for any caller behind a proxy** (load
   * balancer, CDN, reverse proxy, k8s ingress).
   */
  public detectIp() {
    // Trusting `X-Real-IP` is only sound when the config trusts the entire
    // upstream chain; bounded shapes get chain-aware resolution instead.
    if (config.get("http.trustProxy", false) === true) {
      const realIp = this.header("x-real-ip");

      if (realIp) {
        const address = String(realIp).split(",")[0].trim();

        if (address) return address;
      }
    }

    // Fastify resolved this against the configured `trustProxy` already:
    // socket peer when trust is off, the correct hop of `X-Forwarded-For`
    // when it is on. Re-parsing the header here would mean a second, weaker
    // trust model that could disagree with `request.ip` and with the plugins
    // (rate limit, proxy) that key on it.
    return this.baseRequest.ip;
  }

  /**
   * An alias to detectIp
   */
  public get realIp() {
    return this.detectIp();
  }

  /**
   * Get request ips
   */
  public get ips() {
    return this.baseRequest.ips;
  }

  /**
   * Get request referer
   */
  public get referer() {
    return this.baseRequest.headers.referer;
  }

  /**
   * Get user agent
   */
  public get userAgent() {
    return this.baseRequest.headers["user-agent"];
  }

  /**
   * Get request headers
   */
  public get headers(): typeof this.baseRequest.headers {
    return this.baseRequest.headers;
  }

  /**
   * Set the given header
   */
  public setHeader(key: HeaderKeys, value: string) {
    this.baseRequest.headers[key.toLowerCase()] = value;

    return this;
  }
}
