import config from "@mongez/config";
import { environment } from "../utils/environment";

/**
 * `frame-ancestors` policy: `"none"` (no site may frame the response),
 * `"self"` (same origin only) or a list of allowed origins, e.g.
 * `["'self'", "https://partner.example.com"]`.
 */
export type FrameAncestorsPolicy = "none" | "self" | string[];

/**
 * One `Permissions-Policy` feature allowlist. An empty list turns the feature
 * off; `"self"` / `"*"` and origins (`"https://x.example.com"`) turn it on for
 * those scopes.
 */
export type PermissionsPolicyAllowlist = string[];

/** `Strict-Transport-Security` settings. */
export type HstsConfig = {
  /**
   * Seconds the browser remembers to use HTTPS only.
   *
   * @default 31536000 (one year)
   */
  maxAge?: number;
  /**
   * @default true
   */
  includeSubDomains?: boolean;
  /**
   * Add the `preload` token. Opt-in: preloading is hard to undo, so enable it
   * only after reading https://hstspreload.org.
   *
   * @default false
   */
  preload?: boolean;
  /**
   * Send the header only when `NODE_ENV` is `production`. Set `false` to send
   * it in every environment.
   *
   * @default true
   */
  onlyInProduction?: boolean;
};

/**
 * App-facing `http.securityHeaders` configuration. On by default.
 *
 * Every key is optional; set a key to `false` to drop that header, or set
 * `http.securityHeaders: false` to disable all of them.
 *
 * @example
 * ```ts title="src/config/http.ts"
 * const httpConfigurations: HttpConfigurations = {
 *   securityHeaders: {
 *     frameAncestors: "self",
 *     permissionsPolicy: { camera: ["self"] },
 *     hsts: { preload: true },
 *   },
 * };
 * ```
 */
export type SecurityHeadersConfig = {
  /**
   * Emits CSP `frame-ancestors` plus the matching `X-Frame-Options`
   * (`DENY` for `"none"`, `SAMEORIGIN` for `"self"`, omitted for a custom
   * list). `false` emits neither.
   *
   * @default "none"
   */
  frameAncestors?: FrameAncestorsPolicy | false;
  /**
   * `X-Content-Type-Options: nosniff`.
   *
   * @default true
   */
  contentTypeOptions?: boolean;
  /**
   * `Referrer-Policy` value, `false` to omit.
   *
   * @default "strict-origin-when-cross-origin"
   */
  referrerPolicy?: string | false;
  /**
   * `Permissions-Policy` features. An object is merged over
   * {@link DEFAULT_PERMISSIONS_POLICY} per feature; a string is sent as-is;
   * `false` omits the header.
   */
  permissionsPolicy?: Record<string, PermissionsPolicyAllowlist> | string | false;
  /**
   * `Strict-Transport-Security`. `true` (or unset) uses the defaults, an
   * object tunes them, `false` omits the header.
   */
  hsts?: boolean | HstsConfig;
};

/** Per-route value: a partial config merged over the app config, or `false` to opt out. */
export type RouteSecurityHeaders = SecurityHeadersConfig | false;

/**
 * Camera, microphone and geolocation stay available to the app's own pages
 * (`self`) and are blocked for embedded third-party frames; the motion sensors
 * and USB are off. Override per feature in `http.securityHeaders.permissionsPolicy`.
 */
export const DEFAULT_PERMISSIONS_POLICY: Readonly<Record<string, readonly string[]>> = {
  accelerometer: [],
  camera: ["self"],
  geolocation: ["self"],
  gyroscope: [],
  magnetometer: [],
  microphone: ["self"],
  usb: [],
};

export const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";
export const DEFAULT_HSTS_MAX_AGE = 31_536_000;

/** Header name/value pairs, plus the CSP value kept apart so it can merge with `http.csp`. */
export type SecurityHeaderSet = Record<string, string>;

/**
 * Merge a route's override over the app config. `false` at either level wins.
 * Returns `undefined` when everything is disabled.
 */
export function mergeSecurityHeadersConfig(
  appConfig: SecurityHeadersConfig | boolean | null | undefined,
  routeConfig?: RouteSecurityHeaders | null,
): SecurityHeadersConfig | undefined {
  if (appConfig === false || routeConfig === false) return undefined;

  const base = appConfig && typeof appConfig === "object" ? appConfig : {};
  const override = routeConfig && typeof routeConfig === "object" ? routeConfig : {};

  return { ...base, ...override };
}

/** The effective config for the current app and an optional route override. */
export function resolveSecurityHeadersConfig(
  routeConfig?: RouteSecurityHeaders | null,
): SecurityHeadersConfig | undefined {
  return mergeSecurityHeadersConfig(config.get("http.securityHeaders"), routeConfig);
}

/** Normalise a frame-ancestors policy into CSP source tokens. */
export function frameAncestorSources(policy: FrameAncestorsPolicy): string[] {
  if (policy === "none") return ["'none'"];
  if (policy === "self") return ["'self'"];

  return policy.length > 0 ? [...policy] : ["'none'"];
}

/** The `X-Frame-Options` value matching CSP sources, or `undefined` for a custom list. */
export function frameOptionsFor(sources: readonly string[]): string | undefined {
  if (sources.length === 1 && sources[0] === "'none'") return "DENY";
  if (sources.length === 1 && sources[0] === "'self'") return "SAMEORIGIN";

  return undefined;
}

/**
 * Frame-ancestors sources actually in force: `http.csp.directives`'
 * `frame-ancestors` wins when the app set it, otherwise the
 * `securityHeaders` policy. `undefined` when neither source emits one.
 */
export function effectiveFrameAncestors(
  securityConfig: SecurityHeadersConfig | undefined,
): string[] | undefined {
  const cspSources = config.get("http.csp.enabled")
    ? (config.get("http.csp.directives") as Record<string, string[]> | undefined)?.[
        "frame-ancestors"
      ]
    : undefined;

  if (cspSources && cspSources.length > 0) return [...cspSources];

  if (!securityConfig || securityConfig.frameAncestors === false) return undefined;

  return frameAncestorSources(securityConfig.frameAncestors ?? "none");
}

/** Serialise a Permissions-Policy object (`camera=(), geolocation=(self)`). */
export function serializePermissionsPolicy(features: Record<string, readonly string[]>): string {
  return Object.entries(features)
    .map(([feature, allowlist]) => {
      const tokens = allowlist.map((entry) => {
        if (entry === "*") return "*";
        if (entry === "self" || entry === "src") return entry;

        return /^".*"$/.test(entry) ? entry : `"${entry}"`;
      });

      if (tokens.includes("*")) return `${feature}=*`;

      return `${feature}=(${tokens.join(" ")})`;
    })
    .join(", ");
}

function buildHsts(hsts: SecurityHeadersConfig["hsts"]): string | undefined {
  if (hsts === false) return undefined;

  const options: HstsConfig = typeof hsts === "object" && hsts !== null ? hsts : {};

  if ((options.onlyInProduction ?? true) && environment() !== "production") return undefined;

  const parts = [`max-age=${options.maxAge ?? DEFAULT_HSTS_MAX_AGE}`];

  if (options.includeSubDomains ?? true) parts.push("includeSubDomains");
  if (options.preload) parts.push("preload");

  return parts.join("; ");
}

/**
 * Build the header set for a (merged) config. Pure aside from reading
 * `NODE_ENV` (HSTS) and `http.csp` (frame-ancestors precedence).
 */
export function buildSecurityHeaders(
  securityConfig: SecurityHeadersConfig | undefined,
): SecurityHeaderSet {
  const headers: SecurityHeaderSet = {};

  if (!securityConfig) return headers;

  const frameAncestors = securityConfig.frameAncestors ?? "none";

  if (frameAncestors !== false) {
    const sources = effectiveFrameAncestors(securityConfig);

    if (sources) headers["Content-Security-Policy"] = `frame-ancestors ${sources.join(" ")}`;

    // X-Frame-Options follows the effective sources so both headers agree.
    const frameOptions = sources ? frameOptionsFor(sources) : undefined;

    if (frameOptions) headers["X-Frame-Options"] = frameOptions;
  }

  if (securityConfig.contentTypeOptions !== false) {
    headers["X-Content-Type-Options"] = "nosniff";
  }

  const referrerPolicy = securityConfig.referrerPolicy ?? DEFAULT_REFERRER_POLICY;

  if (referrerPolicy !== false) headers["Referrer-Policy"] = referrerPolicy;

  const permissionsPolicy = securityConfig.permissionsPolicy;

  if (permissionsPolicy !== false) {
    headers["Permissions-Policy"] =
      typeof permissionsPolicy === "string"
        ? permissionsPolicy
        : serializePermissionsPolicy({ ...DEFAULT_PERMISSIONS_POLICY, ...permissionsPolicy });
  }

  const hsts = buildHsts(securityConfig.hsts);

  if (hsts) headers["Strict-Transport-Security"] = hsts;

  return headers;
}

type RawResponse = {
  headersSent?: boolean;
  setHeader(name: string, value: string): unknown;
  removeHeader?(name: string): unknown;
};

/**
 * Stamp the headers on the Node response itself, so a handler that calls
 * `reply.raw.writeHead()` keeps them. Safe to call twice: later calls
 * overwrite the same names.
 */
export function applySecurityHeadersToRaw(
  raw: RawResponse,
  routeConfig?: RouteSecurityHeaders | null,
): void {
  if (raw.headersSent) return;

  const headers = buildSecurityHeaders(resolveSecurityHeadersConfig(routeConfig));

  for (const [name, value] of Object.entries(headers)) {
    raw.setHeader(name, value);
  }
}

/** Header names this module may set, lower-cased. */
export const SECURITY_HEADER_NAMES = [
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "strict-transport-security",
] as const;

/**
 * Re-stamp a response for a route that declares its own `securityHeaders`:
 * first drop what the app-wide pass set, then apply the merged result.
 */
export function applyRouteSecurityHeaders(
  raw: RawResponse,
  routeConfig: RouteSecurityHeaders,
): void {
  if (raw.headersSent) return;

  for (const name of SECURITY_HEADER_NAMES) {
    raw.removeHeader?.(name);
  }

  applySecurityHeadersToRaw(raw, routeConfig);
}

/**
 * Register the app-wide `onRequest` hook. It is the earliest hook Fastify
 * offers, and it writes to the Node response so `reply.raw.writeHead()`
 * keeps the headers.
 */
export function registerSecurityHeaders(server: {
  addHook(
    name: "onRequest",
    hook: (request: unknown, reply: { raw: RawResponse }) => Promise<void>,
  ): unknown;
}): void {
  server.addHook("onRequest", async (_request, reply) => {
    applySecurityHeadersToRaw(reply.raw);
  });
}
