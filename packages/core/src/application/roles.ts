/**
 * The three ways a process booted from the same build can serve traffic.
 * `api` and `web` both bind the http port (§`servesHttp`); `worker` never
 * does — it exists to run queue workers, the scheduler and `worker.ts`.
 */
export const APP_ROLES = ["api", "web", "worker"] as const;

/**
 * One of {@link APP_ROLES}. What `Application.hasRole` checks and what
 * `warlock start --role` accepts, comma-separated.
 */
export type AppRole = (typeof APP_ROLES)[number];

const VALID_ROLES_LIST = APP_ROLES.join(", ");

/**
 * Parse a `--role` / `WARLOCK_ROLES` value into the set of roles a process
 * should serve.
 *
 * `undefined` (the flag/variable absent) means "every role" — the same
 * behaviour `warlock start` and `warlock dev` had before roles existed, so a
 * plain `start` or a test run is unaffected. An explicit but empty list, or
 * an entry that is not one of {@link APP_ROLES}, throws rather than silently
 * falling back to "every role", since that would mask a typo as full traffic.
 */
export function parseRoles(value: string | undefined): ReadonlySet<AppRole> {
  if (value === undefined) {
    return new Set(APP_ROLES);
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new Error(`--role received an empty list. Valid roles: ${VALID_ROLES_LIST}.`);
  }

  for (const entry of entries) {
    if (!(APP_ROLES as readonly string[]).includes(entry)) {
      throw new Error(`Unknown role "${entry}". Valid roles: ${VALID_ROLES_LIST}.`);
    }
  }

  return new Set(entries as AppRole[]);
}

/**
 * Parse a `--sites` / `WARLOCK_SITES` value into the set of site keys a
 * `web` process should install pages for.
 *
 * `undefined` means "every site" (the default, unfiltered behaviour). An
 * explicit but empty list throws rather than silently meaning "every site"
 * or "no site" — both would be surprising for a flag that was actually
 * passed. Cross-checking against the active roles and against `web.sites`
 * config happens where both are known, not here.
 */
export function parseSites(value: string | undefined): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new Error("--sites received an empty list.");
  }

  return new Set(entries);
}

/**
 * `--sites` only makes sense alongside the `web` role — an `api`- or
 * `worker`-only process never installs pages, so a sites filter on it could
 * never do anything, and staying silent about that would hide a
 * misconfigured deploy.
 */
export function assertSitesRequireWebRole(
  roles: ReadonlySet<AppRole>,
  sites: ReadonlySet<string> | undefined,
): void {
  if (sites !== undefined && !roles.has("web")) {
    throw new Error("--sites only applies to the web role");
  }
}

let cachedRoles: ReadonlySet<AppRole> | undefined;
let cachedSites: ReadonlySet<string> | undefined;
let sitesResolved = false;

/**
 * The roles this process serves, resolved from `WARLOCK_ROLES` once and
 * cached for the life of the process — the env var is bootstrap input, not
 * something that can meaningfully change mid-run.
 */
function resolveRoles(): ReadonlySet<AppRole> {
  if (!cachedRoles) {
    cachedRoles = parseRoles(process.env.WARLOCK_ROLES);
  }

  return cachedRoles;
}

/**
 * The sites this process installs pages for, resolved from `WARLOCK_SITES`
 * once and cached alongside {@link resolveRoles}. `undefined` means every
 * site.
 */
function resolveSites(): ReadonlySet<string> | undefined {
  if (!sitesResolved) {
    cachedSites = parseSites(process.env.WARLOCK_SITES);
    assertSitesRequireWebRole(resolveRoles(), cachedSites);
    sitesResolved = true;
  }

  return cachedSites;
}

/**
 * The roles this process serves. See {@link resolveRoles}.
 */
export function getRoles(): ReadonlySet<AppRole> {
  return resolveRoles();
}

/**
 * The sites this process installs pages for, or `undefined` for every site.
 * See {@link resolveSites}.
 */
export function getSites(): ReadonlySet<string> | undefined {
  return resolveSites();
}

/**
 * Whether this process serves the given role.
 */
export function hasRole(role: AppRole): boolean {
  return resolveRoles().has(role);
}

/**
 * Whether this process should bind the http port — true when it serves
 * `api` or `web`, false for a `worker`-only process. Shared by the http
 * connector (skips `listen()`) and the production port preflight (skips the
 * probe), so both agree on the same condition.
 */
export function servesHttp(): boolean {
  const roles = resolveRoles();

  return roles.has("api") || roles.has("web");
}

/**
 * Drop the cached roles/sites so the next call to {@link getRoles} /
 * {@link getSites} re-reads `process.env`.
 *
 * @internal Test-only — production code resolves once per process on
 * purpose (see {@link resolveRoles}).
 */
export function resetRolesCacheForTests(): void {
  cachedRoles = undefined;
  cachedSites = undefined;
  sitesResolved = false;
}
