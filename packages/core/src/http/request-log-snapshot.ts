import config from "@mongez/config";
import { DEFAULT_REDACT_KEY_SET, normalizeRedactKey } from "@warlock.js/logger";
import { UploadedFile } from "./uploaded-file";

/**
 * What a request's log entries carry of its input. Set globally under
 * `http.logging` and per route with the route's `logging` option; the route
 * wins key by key, unless a private URL policy suppresses that field.
 *
 * @example
 * // never log the body or the query string of this route, not even redacted
 * router.post("/accounts/credentials", controller, {
 *   logging: { body: false, query: false },
 * });
 */
export type RequestLoggingOptions = {
  /**
   * Include the request body in log entries.
   *
   * The body is logged as RECEIVED, before validation, so fields the schema
   * later rejects are part of it. Turn it off on routes that accept secrets
   * or arbitrary user text.
   *
   * @default true
   */
  body?: boolean;
  /**
   * Include the parsed query string in log entries. The logged URL keeps its
   * path either way; with `query: false` its query string is dropped too.
   *
   * @default true
   */
  query?: boolean;
};

/** A URL policy that can only remove input from snapshots, even on unmatched requests. */
export type PrivateRequestLoggingRule = {
  /** Path prefix at a segment boundary, or a regular expression over the normalized path. */
  path: string | RegExp;
  body?: false;
  query?: false;
};

/**
 * `http.logging`: the app-wide defaults for {@link RequestLoggingOptions},
 * plus query parameter names whose values are masked in logged URLs.
 */
export type HttpLoggingConfig = RequestLoggingOptions & {
  /**
   * Extra query parameter names to mask in logged URLs, on top of the
   * logger's default secret-key denylist and {@link URL_CREDENTIAL_PARAMS}.
   * Matched like the logger's keys: case, `-` and `_` are ignored.
   */
  redactQueryParams?: string[];
  /** URL policies applied before route logging; matching rules cannot be overridden by a route. */
  private?: PrivateRequestLoggingRule[];
};

/**
 * The bounded, plain-data view of a request that Core puts in log entries in
 * place of the `Request`/`Response` instances, whose native request, reply
 * and socket graphs reach every sink otherwise.
 */
export type RequestLogSnapshot = {
  id: string;
  method: string;
  /** Path and query string, with credential-bearing parameter values masked. */
  url: string;
  /** The matched route pattern, e.g. `/users/:id`. */
  route?: string;
  /** The route name, when it has one. */
  name?: string;
  ip?: string;
  userAgent?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
};

/**
 * Query parameters that carry a credential in a URL even though their names
 * are too generic for the logger's key denylist: signed-URL signatures,
 * pre-signed cloud credentials and OAuth authorization codes.
 */
export const URL_CREDENTIAL_PARAMS: readonly string[] = [
  "signature",
  "sig",
  "code",
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "x-goog-signature",
  "x-goog-credential",
];

const URL_CREDENTIAL_PARAM_SET: ReadonlySet<string> = new Set(
  URL_CREDENTIAL_PARAMS.map(normalizeRedactKey),
);

const REDACTED = "[REDACTED]";

/**
 * Mask the values of credential-bearing query parameters in a URL (absolute,
 * or a path with a query string). A parameter is credential-bearing when its
 * normalized name is in the logger's default secret-key denylist (`secret`,
 * `token`, `apiKey`, …), in {@link URL_CREDENTIAL_PARAMS}, or in `extraParams`.
 *
 * The path and the other parameters are kept as written.
 *
 * @example
 * redactUrlCredentials("/hooks?secret=abc&page=2") // "/hooks?secret=[REDACTED]&page=2"
 */
export function redactUrlCredentials(url: string, extraParams: readonly string[] = []): string {
  const queryStart = url.indexOf("?");

  if (queryStart === -1) return url;

  const hashStart = url.indexOf("#", queryStart);
  const queryEnd = hashStart === -1 ? url.length : hashStart;
  const isCredential = credentialParamMatcher(extraParams);

  const query = url
    .slice(queryStart + 1, queryEnd)
    .split("&")
    .map((pair) => {
      const separator = pair.indexOf("=");
      const rawName = separator === -1 ? pair : pair.slice(0, separator);

      let name = rawName;

      try {
        name = decodeURIComponent(rawName.replace(/\+/g, " "));
      } catch {
        // A malformed escape is logged under its raw name.
      }

      if (separator !== -1 && isCredential(name)) {
        return `${rawName}=${REDACTED}`;
      }

      return pair;
    })
    .join("&");

  // A fragment never reaches the server, but a URL handed in by app code may
  // carry one; it is dropped rather than risk logging a token in it.
  return `${url.slice(0, queryStart)}?${query}`;
}

/**
 * A predicate telling whether a query parameter name carries a credential:
 * its normalized name is in the logger's default secret-key denylist, in
 * {@link URL_CREDENTIAL_PARAMS}, or in `extraParams`.
 */
function credentialParamMatcher(extraParams: readonly string[]): (name: string) => boolean {
  const extra = new Set(extraParams.map(normalizeRedactKey));

  return (name) => {
    const key = normalizeRedactKey(name);

    return DEFAULT_REDACT_KEY_SET.has(key) || URL_CREDENTIAL_PARAM_SET.has(key) || extra.has(key);
  };
}

/**
 * Mask the values of credential-bearing parameters in a parsed query object,
 * with the same names {@link redactUrlCredentials} masks in the URL. Nested
 * objects and arrays (`a[b]=…` parsing) are walked; the input is not mutated.
 *
 * @example
 * redactQueryCredentials({ code: "abc", page: "2" }) // { code: "[REDACTED]", page: "2" }
 */
export function redactQueryCredentials(
  query: Record<string, unknown>,
  extraParams: readonly string[] = [],
): Record<string, unknown> {
  return redactQueryObject(query, credentialParamMatcher(extraParams));
}

function redactQueryObject(
  query: Record<string, unknown>,
  isCredential: (name: string) => boolean,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(query)) {
    output[name] = isCredential(name) ? REDACTED : redactQueryValue(value, isCredential);
  }

  return output;
}

function redactQueryValue(value: unknown, isCredential: (name: string) => boolean): unknown {
  if (Array.isArray(value)) return value.map((item) => redactQueryValue(item, isCredential));

  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return redactQueryObject(value as Record<string, unknown>, isCredential);
  }

  return value;
}

/**
 * The effective logging options for a request: `http.logging` overlaid by the
 * route's own `logging` option, then restricted by matching private URL policies.
 */
export function resolveRequestLoggingOptions(
  routeOptions: RequestLoggingOptions | undefined,
  url?: string,
  routePath?: string,
): Required<RequestLoggingOptions> & { redactQueryParams: string[] } {
  const global = (config.get("http.logging") ?? {}) as HttpLoggingConfig;

  const options = {
    body: routeOptions?.body ?? global.body ?? true,
    query: routeOptions?.query ?? global.query ?? true,
    redactQueryParams: global.redactQueryParams ?? [],
  };
  if (!global.private?.length || url === undefined) return options;
  const candidates = loggingPathCandidates(url);
  if (candidates === undefined) return { ...options, body: false, query: false };
  if (routePath) {
    const routeCandidates = loggingPathCandidates(routePath);
    if (!routeCandidates) return { ...options, body: false, query: false };
    candidates.push(...routeCandidates);
  }

  for (const rule of compiledPrivateRules(global.private)) {
    let matches: boolean;
    if (rule.type === "regex") {
      const { regex, needsClone } = rule;
      matches = candidates.some((candidate) =>
        (needsClone ? new RegExp(regex.source, regex.flags) : regex).test(candidate),
      );
    } else {
      const { prefixes } = rule;
      // A malformed configured prefix must never silently disable privacy.
      matches =
        prefixes === undefined ||
        prefixes.some((prefix) =>
          candidates.some(
            (candidate) =>
              prefix === "/" || candidate === prefix || candidate.startsWith(`${prefix}/`),
          ),
        );
    }
    if (!matches) continue;
    if (rule.body === false) options.body = false;
    if (rule.query === false) options.query = false;
  }
  return options;
}

/** A private rule with its path matcher prepared once. */
type CompiledPrivateRule = Pick<PrivateRequestLoggingRule, "body" | "query"> &
  (
    | { type: "regex"; regex: RegExp; needsClone: boolean }
    // `undefined` prefixes: the configured path does not decode, so it matches every request.
    | { type: "prefix"; prefixes: string[] | undefined }
  );

/**
 * Compiled rules per configured `http.logging.private` array. Snapshots are
 * built several times per request, so each array's prefixes are normalised
 * once; replacing the array (a new config value) compiles the new one.
 */
const compiledRulesCache = new WeakMap<
  readonly PrivateRequestLoggingRule[],
  CompiledPrivateRule[]
>();

function compiledPrivateRules(rules: readonly PrivateRequestLoggingRule[]): CompiledPrivateRule[] {
  let compiled = compiledRulesCache.get(rules);
  if (compiled) return compiled;
  compiled = rules.map((rule): CompiledPrivateRule => {
    const { path, body, query } = rule;
    if (path instanceof RegExp) {
      // A global or sticky regex keeps `lastIndex` between tests; use a fresh copy.
      return { type: "regex", regex: path, needsClone: path.global || path.sticky, body, query };
    }
    return { type: "prefix", prefixes: loggingPathCandidates(path), body, query };
  });
  compiledRulesCache.set(rules, compiled);
  return compiled;
}

/** Backslashes to slashes, repeated slashes collapsed, no trailing slash. */
function collapseLoggingPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}

function loggingPathCandidates(url: string): string[] | undefined {
  try {
    // Preserve raw dot segments in absolute-form requests; URL() would erase them.
    const pathname = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*/i, "").split(/[?#]/u)[0] || "/";
    const raw = collapseLoggingPath(pathname);
    const decoded = collapseLoggingPath(decodeURIComponent(pathname));
    const segments: string[] = [];
    for (const segment of decoded.split("/")) {
      if (segment === "..") segments.pop();
      else if (segment && segment !== ".") segments.push(segment);
    }
    return [...new Set([raw, decoded, `/${segments.join("/")}`])];
  } catch {
    // With a private-path policy, undecodable input is withheld rather than guessed.
    return undefined;
  }
}

/**
 * The fields of a request the snapshot reads. Structural, so the snapshot can
 * be built (and tested) without a live Fastify request.
 */
export type RequestLogSource = {
  id: string;
  method: string;
  url: string;
  ip?: string;
  userAgent?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  route?: { path?: string; name?: string; logging?: RequestLoggingOptions };
};

/**
 * Build the {@link RequestLogSnapshot} for a request, applying the route's
 * logging policy BEFORE anything reaches a log entry: an omitted body or
 * query is never copied, so no sink, channel or redaction setting can expose it.
 * Credential-bearing query parameters are masked in both `url` and `query`.
 *
 * Uploaded files are summarised (`{ file, mimeType }`) rather than walked.
 */
export function buildRequestLogSnapshot(source: RequestLogSource): RequestLogSnapshot {
  const options = resolveRequestLoggingOptions(
    source.route?.logging,
    source.url,
    source.route?.path,
  );
  const url = options.query ? source.url : stripQuery(source.url);

  const snapshot: RequestLogSnapshot = {
    id: source.id,
    method: source.method,
    url: redactUrlCredentials(url ?? "", options.redactQueryParams),
  };

  if (source.route?.path) snapshot.route = source.route.path;
  if (source.route?.name) snapshot.name = source.route.name;
  if (source.ip) snapshot.ip = source.ip;
  if (source.userAgent) snapshot.userAgent = source.userAgent;

  if (options.query && source.query && Object.keys(source.query).length > 0) {
    snapshot.query = redactQueryCredentials(source.query, options.redactQueryParams);
  }

  if (options.body && source.body && Object.keys(source.body).length > 0) {
    snapshot.body = summariseFiles(source.body);
  }

  return snapshot;
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) return url;

  const queryStart = url.indexOf("?");

  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function summariseFiles(body: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    output[key] = Array.isArray(value) ? value.map(summariseFile) : summariseFile(value);
  }

  return output;
}

function summariseFile(value: unknown): unknown {
  if (!(value instanceof UploadedFile)) return value;

  return { file: value.name, mimeType: value.mimeType };
}
