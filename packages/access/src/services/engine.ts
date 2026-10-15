import type { Auth } from "@warlock.js/auth";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import type { AccessContext } from "../contracts/types";
import { AccessConfigError } from "../utils/access-config-error";
import { accessConfig } from "./access-config";
import { matchesPermission } from "./matcher";
import { getPolicy } from "./policies";

const PERMISSIONS_PREFIX = "access.perms.";
const ROLES_PREFIX = "access.roles.";

/**
 * Permissions that have already triggered the "unpoliced instance check"
 * warning below — kept so a hot path doesn't log once per request.
 */
const warnedUnpolicedPermissions = new Set<string>();

/** Reset the once-per-permission warning tracker. Primarily for tests. */
export function resetUnpolicedWarnings(): void {
  warnedUnpolicedPermissions.clear();
}

/** Resolve the effective tenant for a check (explicit → ambient → undefined). */
function tenantFor(user: Auth, context: AccessContext): string | undefined {
  return context.tenant ?? accessConfig.tenant(user);
}

function cacheKey(prefix: string, user: Auth, tenant?: string): string {
  // Encode each segment so a `.` in an id or tenant can't collide two distinct
  // principals onto the same cache key (and serve one's grants to the other).
  const segment = (value: unknown) => encodeURIComponent(String(value));

  return `${prefix}${segment(user.userType)}.${segment(user.id)}.${segment(tenant ?? "_")}`;
}

/**
 * Read a list through the cache, falling back to the loader.
 *
 * The cache is **best-effort**: a cache failure degrades to the loader (the
 * source of truth) and is logged, never denied. A loader failure propagates —
 * so the DECISION fails closed in {@link check}.
 */
async function cached(
  key: string,
  loader: () => Promise<string[]>,
): Promise<string[]> {
  try {
    const hit = await cache.get<string[]>(key);

    if (hit) return hit;
  } catch (error) {
    log.error("access", "cache", error);
  }

  const value = await loader();

  try {
    await cache.set(key, value, { ttl: accessConfig.cacheTtl() });
  } catch (error) {
    log.error("access", "cache", error);
  }

  return value;
}

/** The user's effective permission set for a tenant (cached). */
export function permissionsFor(user: Auth, tenant?: string): Promise<string[]> {
  return cached(cacheKey(PERMISSIONS_PREFIX, user, tenant), () =>
    accessConfig.resolver().resolvePermissions(user, tenant),
  );
}

/** The user's roles for a tenant (cached). */
export function rolesFor(user: Auth, tenant?: string): Promise<string[]> {
  return cached(cacheKey(ROLES_PREFIX, user, tenant), () =>
    accessConfig.resolver().resolveRoles(user, tenant),
  );
}

/** Drop the cached role/permission sets for a user (after any out-of-band role change). */
export async function flush(user: Auth, tenant?: string): Promise<void> {
  try {
    await cache.remove(cacheKey(PERMISSIONS_PREFIX, user, tenant));
    await cache.remove(cacheKey(ROLES_PREFIX, user, tenant));
  } catch (error) {
    log.error("access", "cache", error);
  }
}

/**
 * Surface a resource-scoped check that has no registered ABAC policy, and
 * report whether the check should now DENY.
 *
 * `strictPolicies` defaults to `true`: a forgotten `definePolicy` call (typo'd
 * permission name, or a missing `import "./policies"` side-effect — the
 * single most common mistake app teams make with this package, per the
 * `define-policies` skill) must never fail OPEN, so the check denies.
 *
 * `strictPolicies: false` explicitly restores the pre-5.13 behavior: fall
 * back to the RBAC grant alone (ALLOW), which is a plausible IDOR if the
 * permission was meant to be resource-scoped.
 *
 * Either way this warns once per permission (not once per call) so a hot
 * request path doesn't spam logs — mirrors cascade's
 * `warnUndeclaredSensitiveFields`.
 */
function unpolicedShouldDeny(permission: string): boolean {
  const strict = accessConfig.strictPolicies();

  if (!warnedUnpolicedPermissions.has(permission)) {
    warnedUnpolicedPermissions.add(permission);

    log.warn(
      "access",
      "unpoliced-check",
      strict
        ? `Instance-level check for permission "${permission}" has no registered ABAC policy — ` +
            `DENYING (strictPolicies defaults to true as of 5.13). Register one with ` +
            `definePolicy("${permission}", ...), or make sure the module that calls definePolicy is ` +
            `actually imported. Set strictPolicies: false in the access config to restore the pre-5.13 ` +
            `RBAC-only fallback (ALLOWS — not recommended).`
        : `Instance-level check for permission "${permission}" has no registered ABAC policy — falling ` +
            `back to the RBAC grant alone (strictPolicies: false), so any holder of "${permission}" can ` +
            `act on ANY resource. If this permission is meant to be resource-scoped, register a policy ` +
            `with definePolicy("${permission}", ...) (and confirm the module that calls it is ` +
            `imported), or remove strictPolicies: false to deny by default.`,
    );
  }

  return strict;
}

/**
 * The core decision: does the user hold `permission`, and — when a `resource`
 * is supplied — does its policy pass too?
 *
 * Fails CLOSED: any error while resolving the decision denies (and logs). An
 * instance-level check for a permission with no registered policy also fails
 * CLOSED by default ({@link AccessConfigurations.strictPolicies}) rather than
 * falling back to the RBAC grant alone.
 */
export async function check(
  user: Auth,
  permission: string,
  context: AccessContext = {},
): Promise<boolean> {
  try {
    const tenant = tenantFor(user, context);
    const permissions = await permissionsFor(user, tenant);

    if (!matchesPermission(permissions, permission)) return false;

    const policy = getPolicy(permission);

    // A policy only runs on an instance check (a resource was supplied);
    // class-level checks (`gate`) stop at the grant.
    if (context.resource !== undefined && policy === undefined) {
      if (unpolicedShouldDeny(permission)) return false;
    }

    if (policy === undefined || context.resource === undefined) return true;

    const roles = await rolesFor(user, tenant);

    return Boolean(
      await policy(user, context.resource, {
        ...context,
        tenant,
        hasRole: (role) => roles.includes(role),
        hasPermission: (perm) => matchesPermission(permissions, perm),
      }),
    );
  } catch (error) {
    if (error instanceof AccessConfigError) throw error; // misconfig is loud, not a silent deny

    log.error("access", "check", error);

    return false;
  }
}
