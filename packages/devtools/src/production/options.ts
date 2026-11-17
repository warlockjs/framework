import type { DevtoolsLogEntry, DevtoolsProductionOptions } from "../types";

/**
 * `DevtoolsProductionOptions` with every default applied and the environment
 * read. Built once at boot by `resolveProductionOptions`.
 */
export type ResolvedDevtoolsProductionOptions = {
  /** The dashboard path, without a trailing slash. */
  path: string;
  /** The first admin from the environment; every field `null` when unset. */
  admin: { email: string | null; password: string | null; setupToken: string | null };
  sampleRate: number;
  slowRequestMs: number;
  slowQueryMs: number;
  maxRequests: number;
  /** Queries kept per sampled request; the rest are counted in `droppedQueries`. */
  maxQueriesPerRequest: number;
  /** Query shapes kept in memory per process (least recently seen evicted). */
  maxShapes: number;
  /** Route keys kept in memory per process. */
  maxRoutes: number;
  /** Error groups kept in memory per process. */
  maxErrorGroups: number;
  requestRetentionHours: number;
  maxStoredSamplesPerMinute: number;
  reportIntervalMs: number;
  trustedProxies: readonly string[];
  requireHttps: boolean;
  allowedIps: readonly string[];
  origin: string | null;
  session: { idleMinutes: number; maxHours: number; pendingMinutes: number };
  twoFactor: "admins" | "everyone";
  rateLimits: {
    windowMinutes: number;
    account: number;
    ip: number;
    global: number;
    lockMinutes: number;
  };
  explain: { executing: boolean };
  panels: Readonly<Record<string, boolean>>;
  logLevels: readonly DevtoolsLogEntry["level"][];
  auditRetentionDays: number;
  passkeys: { rpName: string; rpId: string | null };
};

/** The defaults `resolveProductionOptions` applies (environment values excluded). */
export const DEVTOOLS_PRODUCTION_DEFAULTS = {
  sampleRate: 0.1,
  slowRequestMs: 1000,
  slowQueryMs: 200,
  maxRequests: 200,
  maxQueriesPerRequest: 200,
  maxShapes: 500,
  maxRoutes: 300,
  maxErrorGroups: 100,
  requestRetentionHours: 24,
  maxStoredSamplesPerMinute: 120,
  reportIntervalMs: 10_000,
  requireHttps: true,
  session: { idleMinutes: 30, maxHours: 8, pendingMinutes: 10 },
  twoFactor: "admins",
  rateLimits: { windowMinutes: 15, account: 5, ip: 20, global: 100, lockMinutes: 15 },
  explain: { executing: false },
  logLevels: ["warn", "error"],
  auditRetentionDays: 90,
  passkeys: { rpName: "Warlock monitor" },
} as const;

/** The environment variables production mode reads. */
export const DEVTOOLS_ENV = {
  path: "DEVTOOLS_PATH",
  adminEmail: "DEVTOOLS_ADMIN_EMAIL",
  adminPassword: "DEVTOOLS_ADMIN_PASSWORD",
  setupToken: "DEVTOOLS_SETUP_TOKEN",
} as const;

/**
 * Applies the defaults to `options`, reads the path and first admin from
 * `env`, and validates everything.
 *
 * Throws `DevtoolsProductionConfigError`: DT001 (no path), DT002 (bad path),
 * DT007 (an option out of range: sampleRate outside 0–1, a non-positive
 * limit, an unknown twoFactor value, a bad CIDR, an origin that is not
 * `https://host[:port]`), DT009 (both a password and a setup token), DT010
 * (setup token shorter than 32 characters). DT003/DT004 (admin) are checked
 * later by `ensureFirstAdmin`, which needs the database.
 *
 * Owner: WP-3.
 */
export function resolveProductionOptions(
  _options: DevtoolsProductionOptions | undefined,
  _env: Readonly<Record<string, string | undefined>>,
): ResolvedDevtoolsProductionOptions {
  throw new Error("not implemented");
}
