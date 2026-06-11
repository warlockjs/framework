import type { Auth } from "@warlock.js/auth";
import { cache } from "@warlock.js/cache";
import { log } from "@warlock.js/logger";
import type { AccessContext } from "../contracts/types";
import { accessConfig } from "./access-config";
import { matchesPermission } from "./matcher";
import { getPolicy } from "./policies";

const PERMISSIONS_PREFIX = "access.perms.";
const ROLES_PREFIX = "access.roles.";

/** Resolve the effective tenant for a check (explicit → ambient → undefined). */
function tenantFor(context: AccessContext): string | undefined {
  return context.tenant ?? accessConfig.tenant();
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
async function cached(key: string, loader: () => Promise<string[]>): Promise<string[]> {
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
    accessConfig.resolver().permissionsOf(user, tenant),
  );
}

/** The user's roles for a tenant (cached). */
export function rolesFor(user: Auth, tenant?: string): Promise<string[]> {
  return cached(cacheKey(ROLES_PREFIX, user, tenant), () =>
    accessConfig.resolver().rolesOf(user, tenant),
  );
}

/** Drop the cached role/permission sets for a user (call after assign/revoke). */
export async function flush(user: Auth, tenant?: string): Promise<void> {
  try {
    await cache.remove(cacheKey(PERMISSIONS_PREFIX, user, tenant));
    await cache.remove(cacheKey(ROLES_PREFIX, user, tenant));
  } catch (error) {
    log.error("access", "cache", error);
  }
}

/**
 * The core decision: does the user hold `permission`, and — when a `resource`
 * is supplied — does its policy pass too?
 *
 * Fails CLOSED: any error while resolving the decision denies (and logs).
 */
export async function check(
  user: Auth,
  permission: string,
  context: AccessContext = {},
): Promise<boolean> {
  try {
    const tenant = tenantFor(context);
    const permissions = await permissionsFor(user, tenant);

    if (!matchesPermission(permissions, permission)) return false;

    const policy = getPolicy(permission);

    // A policy only runs on an instance check (a resource was supplied);
    // class-level checks (`requirePermission`) stop at the grant.
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
    log.error("access", "check", error);

    return false;
  }
}
