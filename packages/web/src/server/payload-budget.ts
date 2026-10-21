/**
 * The inline payload budget: how many bytes of one rendered document's
 * hydration data the application may embed, measured per document and reported
 * once per route when it is exceeded.
 *
 * "Inline payload" is what the document carries for the browser: the
 * `#__WARLOCK_DATA__` script (page, layout and app data, translations, session
 * and the other hydration slots) plus the named API route table. Each section
 * is measured as the devalue text the document actually embeds, so the sum is
 * what a visitor downloads in the HTML for that page.
 *
 * CONFIGURATION is `build.budgets.payload` (core's `PayloadBudget`):
 *
 *   `page`   the default limit per document, `"64kb"` when omitted;
 *   `pages`  route-path globs (`*`, `**`, `?`) overriding `page`, the later
 *            matching entry winning, the same rule as the client budgets;
 *   `mode`   `"warn"` (default) logs a warning, `"error"` logs at error level.
 *            Neither ever fails a request.
 *
 * The limits are resolved at BUILD time for production (`PageManifest.payloadBudget`)
 * and read from the live config in development, so the same numbers apply in
 * both. The measurement itself is a runtime one: a page's payload depends on
 * its loaders, which only a request can run, so `warlock build --json` does not
 * report it.
 *
 * Depends on nothing but devalue, so the production manifest path can import it.
 */
import { stringify } from "devalue";
import type { HydrationDocumentPayloadSource } from "../components/document-context";
import type { NamedApiRouteMetadata } from "../routing/named-api-routes";
import type { PagePayloadBudget } from "./page-manifest";

/** The limit a document gets when the application configures none. */
export const DEFAULT_PAYLOAD_BUDGET_BYTES = 64 * 1024;

/** The sections a document's inline payload is split into. */
export type PayloadSection =
  | "page"
  | "layout"
  | "app"
  | "translations"
  | "routes"
  | "session"
  | "other";

export const PAYLOAD_SECTIONS: readonly PayloadSection[] = [
  "page",
  "layout",
  "app",
  "translations",
  "routes",
  "session",
  "other",
];

/** One rendered document's inline payload, measured in bytes. */
export type PayloadMeasurement = {
  /** The sum of every section. */
  readonly total: number;
  readonly sections: Readonly<Record<PayloadSection, number>>;
};

/** Bytes of a value's devalue text as the document embeds it; `undefined` is not embedded. */
export function serializedBytes(value: unknown): number {
  if (value === undefined) return 0;
  return new TextEncoder().encode(stringify(value)).length;
}

/** The payload keys that are measured as sections of their own. */
const SECTION_KEYS: ReadonlySet<string> = new Set([
  "pageData",
  "layoutData",
  "appData",
  "translations",
  "session",
]);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}

/**
 * Splits the document's inline payload into its sections. `routes` is the
 * named API route table, which the document carries beside the payload.
 */
export function measureDocumentPayload(
  payload: HydrationDocumentPayloadSource,
  routes: NamedApiRouteMetadata | undefined,
): PayloadMeasurement {
  const sections: Record<PayloadSection, number> = {
    page: serializedBytes(payload.pageData),
    layout: serializedBytes(payload.layoutData),
    app: serializedBytes(payload.appData),
    translations: serializedBytes(payload.translations),
    routes: serializedBytes(routes),
    session: serializedBytes(payload.session),
    other: 0,
  };

  // Everything the payload carries that is not one of the sections above. The
  // route table travels in its own script, so the copy the payload's `document`
  // slot holds is not measured a second time.
  const other: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!SECTION_KEYS.has(key)) other[key] = value;
  }
  if (isPlainRecord(other.document)) other.document = withoutKey(other.document, "namedApiRoutes");
  sections.other = serializedBytes(other);

  const total = PAYLOAD_SECTIONS.reduce((sum, section) => sum + sections[section], 0);

  return { total, sections };
}

/**
 * The largest top-level keys of the data sections (`pageData.products`, ...),
 * for the diagnostic line. Computed only when a document is over budget, so a
 * document within budget pays for nothing beyond the section sizes.
 */
export function largestPayloadKeys(
  payload: HydrationDocumentPayloadSource,
  count = 3,
): { readonly key: string; readonly bytes: number }[] {
  const entries: { key: string; bytes: number }[] = [];
  const dataSections = [
    ["pageData", payload.pageData],
    ["layoutData", payload.layoutData],
    ["appData", payload.appData],
  ] as const;

  for (const [section, data] of dataSections) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) continue;
    for (const [key, value] of Object.entries(data)) {
      entries.push({ key: `${section}.${key}`, bytes: serializedBytes(value) });
    }
  }

  return entries.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key)).slice(0, count);
}

const SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|kb|mb)$/i;
const UNITS: Readonly<Record<string, number>> = { b: 1, kb: 1024, mb: 1024 * 1024 };

/** `"64kb"`, `"1.5mb"` or `"4096b"` as bytes. */
export function parsePayloadSize(size: string): number {
  const match = SIZE_PATTERN.exec(size.trim());
  if (!match) {
    throw new Error(
      `Invalid payload budget ${JSON.stringify(size)}: use bytes, kb or mb, e.g. "64kb".`,
    );
  }
  const bytes = Number(match[1]) * (UNITS[match[2]?.toLowerCase() ?? ""] ?? 0);
  if (!Number.isFinite(bytes)) throw new Error(`Invalid payload budget ${JSON.stringify(size)}.`);
  return bytes;
}

/**
 * The route-path glob rule `build.budgets` uses (`*`, `**`, `?`). Any other
 * glob syntax is refused, so a pattern cannot silently match nothing.
 */
export function payloadPatternMatches(pattern: string, routePath: string): boolean {
  if (/[[\]{}()!\\]/.test(pattern)) {
    throw new Error(
      `Invalid payload budget pattern ${JSON.stringify(pattern)}: supported wildcards are *, ** and ?.`,
    );
  }
  let expression = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index++;
      if (pattern[index + 1] === "/") {
        expression += "(?:.*/)?";
        index++;
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character?.replace(/[.+^$|]/g, "\\$&") ?? "";
  }
  return new RegExp(`${expression}$`).test(routePath);
}

/** The configuration shape `build.budgets.payload` takes, as the user writes it. */
export type PayloadBudgetConfig = {
  readonly page?: string;
  readonly pages?: Readonly<Record<string, string>>;
  readonly mode?: "warn" | "error";
};

/**
 * Resolves the configured budget to bytes, validating every size and pattern
 * up front. The result is what both the build and the runtime carry.
 */
export function resolvePayloadBudget(config: PayloadBudgetConfig | undefined): PagePayloadBudget {
  const mode = config?.mode ?? "warn";
  if (mode !== "warn" && mode !== "error") {
    throw new Error('build.budgets.payload.mode must be "warn" or "error".');
  }
  const page =
    config?.page === undefined ? DEFAULT_PAYLOAD_BUDGET_BYTES : parsePayloadSize(config.page);
  const pages = Object.entries(config?.pages ?? {}).map(([pattern, size]) => {
    payloadPatternMatches(pattern, "");
    return { pattern, bytes: parsePayloadSize(size) };
  });

  return { page, pages, mode };
}

/** The limit and mode for one route path: the page default, overridden by the last matching pattern. */
export function payloadBudgetFor(
  budget: PagePayloadBudget,
  routePath: string,
): { readonly bytes: number; readonly mode: "warn" | "error" } {
  let bytes = budget.page;
  for (const entry of budget.pages) {
    if (payloadPatternMatches(entry.pattern, routePath)) bytes = entry.bytes;
  }
  return { bytes, mode: budget.mode };
}

/** Route names already reported in this process: one line per route, never per request. */
const reportedRoutes = new Set<string>();

/** Test seam: forget which routes were already reported. */
export function resetPayloadBudgetReports(): void {
  reportedRoutes.clear();
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)}kb`;

/** The one diagnostic line for an over-budget route, with its breakdown. */
export function formatPayloadBudgetReport(input: {
  readonly route: string;
  readonly path: string;
  readonly total: number;
  readonly limit: number;
  readonly measurement: PayloadMeasurement;
  readonly keys: readonly { readonly key: string; readonly bytes: number }[];
}): string {
  const sections = PAYLOAD_SECTIONS.map(
    (section) => `${section} ${kb(input.measurement.sections[section])}`,
  ).join(", ");
  const keys = input.keys.map((entry) => `${entry.key} (${kb(entry.bytes)})`).join(", ");
  return (
    `Route ${JSON.stringify(input.route)} (${input.path}) embeds ${kb(input.total)} of inline payload, ` +
    `over its ${kb(input.limit)} budget. Sections: ${sections}.` +
    (keys.length > 0 ? ` Largest keys: ${keys}.` : "") +
    " Load less data on this page, or raise build.budgets.payload for it."
  );
}

/**
 * Checks one rendered document against its budget and reports an overage once
 * per route. Never throws: a budget is advisory, and a render must not fail
 * because its diagnostic could not be produced.
 */
export function reportPayloadBudget(input: {
  readonly budget: PagePayloadBudget;
  readonly route: { readonly name: string; readonly path: string };
  readonly payload: HydrationDocumentPayloadSource;
  readonly routes: NamedApiRouteMetadata | undefined;
}): void {
  // Checked before measuring: a route is reported once per process, and a route
  // already reported needs no further measuring.
  if (reportedRoutes.has(input.route.name)) return;

  try {
    const { bytes, mode } = payloadBudgetFor(input.budget, input.route.path);
    const measurement = measureDocumentPayload(input.payload, input.routes);
    if (measurement.total <= bytes) return;

    reportedRoutes.add(input.route.name);
    const message = formatPayloadBudgetReport({
      route: input.route.name,
      path: input.route.path,
      total: measurement.total,
      limit: bytes,
      measurement,
      keys: largestPayloadKeys(input.payload),
    });

    if (mode === "error") console.error(`[warlock:web] ${message}`);
    else console.warn(`[warlock:web] ${message}`);
  } catch (error) {
    reportedRoutes.add(input.route.name);
    console.warn(
      `[warlock:web] Could not measure the inline payload of route ${JSON.stringify(input.route.name)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
