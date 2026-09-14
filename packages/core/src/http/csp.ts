import config from "@mongez/config";
import type { Request } from "./request";
import type { Response } from "./response";

/**
 * App-facing `http.csp` configuration shape.
 *
 * Disabled by default: an app that never sets `http.csp` (or sets
 * `enabled: false`) gets no `Content-Security-Policy` header at all — zero
 * behaviour change for every existing app. Opting in only swaps `enabled` to
 * `true`; `reportOnly` and `directives` are optional refinements on top.
 *
 * @example
 * ```ts title="src/config/http.ts"
 * const httpConfigurations: HttpConfigurations = {
 *   csp: {
 *     enabled: true,
 *     directives: {
 *       "img-src": ["'self'", "data:", "https://cdn.example.com"],
 *     },
 *   },
 * };
 * ```
 */
export type CspConfig = {
  /**
   * Turn the header on. Everything else in this type is inert while this is
   * `false`/unset.
   */
  enabled: boolean;
  /**
   * Emit `Content-Security-Policy-Report-Only` instead of the enforcing
   * `Content-Security-Policy` header — the browser reports violations
   * (via `report-to`/`report-uri`, if the app's directives configure one)
   * without blocking anything. Use this to observe a policy safely before
   * enforcing it.
   *
   * @default false
   */
  reportOnly?: boolean;
  /**
   * App-supplied directive values. A directive named here REPLACES the
   * framework's default list for that directive entirely (the two lists are
   * never merged element-wise) — declare the full value list you want.
   *
   * `script-src` is special-cased regardless of whether it is declared here:
   * the current request's CSP nonce (`'nonce-<value>'`) is always appended to
   * it, so the framework's own inline/module scripts keep working.
   */
  directives?: Record<string, string[]>;
};

/**
 * The policy every `http.csp`-enabled app starts from. Deliberately
 * conservative — same-origin by default, no plugins, no framing by other
 * sites — and documented here rather than only in the skill, since this is
 * the literal set an app's `directives` entry replaces one key at a time.
 */
export const DEFAULT_CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'self'"],
};

/**
 * Thrown at boot when `http.csp.directives` contains a value the framework
 * refuses to ship as-is, rather than silently dropping or rewriting it.
 *
 * Two shapes are rejected:
 * - a value containing `;` — CSP directives are `;`-delimited, so a `;`
 *   inside one value would prematurely close it and let the remainder be
 *   parsed as a new, attacker-uncontrolled-but-developer-typo'd directive.
 * - a value with an odd number of `'` characters — every CSP keyword
 *   (`'self'`, `'none'`, a nonce/hash source) is single-quote-wrapped, so an
 *   unbalanced count means a keyword was truncated or malformed.
 */
export class InvalidCspDirectiveError extends Error {
  public constructor(
    public readonly directive: string,
    public readonly value: string,
    reason: string,
  ) {
    super(
      `Invalid "http.csp.directives" entry — directive "${directive}" has a value ` +
        `${JSON.stringify(value)} that ${reason} Fix the value in your app's http config; ` +
        `the framework will not silently repair it.`,
    );
    this.name = "InvalidCspDirectiveError";
  }
}

/**
 * Validate every directive value an app supplied, throwing
 * {@link InvalidCspDirectiveError} on the first offender.
 *
 * Exported so boot code and tests can call it directly, independent of
 * whether `http.csp` happens to be enabled.
 */
export function validateCspDirectives(directives: Record<string, string[]> | undefined): void {
  if (!directives) return;

  for (const [directive, values] of Object.entries(directives)) {
    for (const value of values) {
      if (value.includes(";")) {
        throw new InvalidCspDirectiveError(
          directive,
          value,
          "contains a ';' character, which would truncate the directive.",
        );
      }

      const quoteCount = (value.match(/'/g) ?? []).length;
      if (quoteCount % 2 !== 0) {
        throw new InvalidCspDirectiveError(
          directive,
          value,
          "has an unbalanced number of ' characters.",
        );
      }
    }
  }
}

/**
 * Read the app's `http.csp` config, if any.
 */
export function resolveCspConfig(): CspConfig | undefined {
  return config.get("http.csp");
}

/**
 * Fail the boot loudly when `http.csp` is enabled with invalid directives.
 *
 * Called once, from {@link createHttpApplication} before the server starts
 * listening — never per-request. A per-request validation would let an app
 * boot successfully and only discover the bad config on first traffic;
 * checking once at boot surfaces it immediately, the same way a malformed
 * `warlock.config.ts` would.
 *
 * @throws {InvalidCspDirectiveError} when a directive value is malformed.
 */
export function validateCspConfigAtBoot(): void {
  const cspConfig = resolveCspConfig();

  if (!cspConfig?.enabled) return;

  validateCspDirectives(cspConfig.directives);
}

/**
 * Merge the app's directives over the framework defaults and fold in the
 * request's nonce.
 *
 * Per-directive replacement, not element-wise merging: a directive the app
 * names wins outright, everything else falls back to
 * {@link DEFAULT_CSP_DIRECTIVES}. `script-src` always gains
 * `'nonce-<nonce>'` on top, whichever list it started from, so the
 * framework's own inline payload script and hydration module script are
 * never blocked by an app's own policy.
 */
export function mergeCspDirectives(
  appDirectives: Record<string, string[]> | undefined,
  nonce: string,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};

  for (const [directive, defaultValues] of Object.entries(DEFAULT_CSP_DIRECTIVES)) {
    merged[directive] = appDirectives?.[directive]
      ? [...appDirectives[directive]]
      : [...defaultValues];
  }

  if (appDirectives) {
    for (const [directive, values] of Object.entries(appDirectives)) {
      if (!(directive in merged)) {
        merged[directive] = [...values];
      }
    }
  }

  const nonceSource = `'nonce-${nonce}'`;
  if (!merged["script-src"].includes(nonceSource)) {
    merged["script-src"] = [...merged["script-src"], nonceSource];
  }

  return merged;
}

/**
 * Serialize a merged directive map into a header value —
 * `"default-src 'self'; script-src 'self' 'nonce-...'; ..."`.
 */
export function serializeCspDirectives(directives: Record<string, string[]>): string {
  return Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

/**
 * Build the full `Content-Security-Policy` (or `-Report-Only`) header value
 * for one request, using that request's own nonce.
 */
export function buildCspHeaderValue(cspConfig: CspConfig, nonce: string): string {
  return serializeCspDirectives(mergeCspDirectives(cspConfig.directives, nonce));
}

/**
 * Stamp the `Content-Security-Policy` (or, in `reportOnly` mode,
 * `Content-Security-Policy-Report-Only`) header on the response, when the
 * app opted in via `http.csp.enabled`.
 *
 * A no-op when `http.csp` is absent or `enabled` is falsy — the default,
 * behaviour-preserving state for every app that hasn't opted in.
 *
 * Reads `request.nonce`, which lazily generates and caches the per-request
 * nonce (`request.ts`) — calling this early in the request lifecycle (see
 * `inject-request-context.ts`) means the SAME nonce this stamps into the
 * header is the one still available later for the web layer's `<script>`
 * tags to read off `request.nonce`.
 */
export function applyCspHeader(request: Request, response: Response): void {
  const cspConfig = resolveCspConfig();

  if (!cspConfig?.enabled) return;

  const headerName = cspConfig.reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  response.header(headerName, buildCspHeaderValue(cspConfig, request.nonce));
}
