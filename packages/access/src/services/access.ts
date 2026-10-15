import type { Auth } from "@warlock.js/auth";
import { ForbiddenError, t } from "@warlock.js/core";
import type { AccessContext } from "../contracts/types";
import { AccessErrorCodes } from "../utils/access-error-codes";
import { check, flush as flushUser, rolesFor } from "./engine";

/** Whether the user holds `permission` (and passes its policy when a resource is given). */
export function can(
  user: Auth,
  permission: string,
  context?: AccessContext,
): Promise<boolean> {
  return check(user, permission, context);
}

/** Inverse of {@link can}. */
export async function cannot(
  user: Auth,
  permission: string,
  context?: AccessContext,
): Promise<boolean> {
  return !(await can(user, permission, context));
}

/** Whether the user holds EVERY listed permission. Short-circuits on the first miss. */
export async function canAll(
  user: Auth,
  permissions: string[],
  context?: AccessContext,
): Promise<boolean> {
  for (const permission of permissions) {
    if (!(await can(user, permission, context))) return false;
  }

  return true;
}

/** Whether the user holds ANY listed permission. Short-circuits on the first hit. */
export async function canAny(
  user: Auth,
  permissions: string[],
  context?: AccessContext,
): Promise<boolean> {
  for (const permission of permissions) {
    if (await can(user, permission, context)) return true;
  }

  return false;
}

function forbidden(): never {
  throw new ForbiddenError(t("access.errors.forbidden"), {
    errorCode: AccessErrorCodes.Forbidden,
  });
}

/** Assert the user holds `permission`; throw `ForbiddenError` (403) otherwise. */
export async function authorize(
  user: Auth,
  permission: string,
  context?: AccessContext,
): Promise<void> {
  if (!(await can(user, permission, context))) forbidden();
}

/** Assert the user holds EVERY listed permission; throw otherwise. */
export async function authorizeAll(
  user: Auth,
  permissions: string[],
  context?: AccessContext,
): Promise<void> {
  if (!(await canAll(user, permissions, context))) forbidden();
}

/** Assert the user holds ANY listed permission; throw otherwise. */
export async function authorizeAny(
  user: Auth,
  permissions: string[],
  context?: AccessContext,
): Promise<void> {
  if (!(await canAny(user, permissions, context))) forbidden();
}

/** Whether the user has the given role. */
export async function hasRole(
  user: Auth,
  role: string,
  tenant?: string,
): Promise<boolean> {
  return (await rolesFor(user, tenant)).includes(role);
}

/** Whether the user has ANY of the given roles. */
export async function hasAnyRole(
  user: Auth,
  roles: string[],
  tenant?: string,
): Promise<boolean> {
  const held = await rolesFor(user, tenant);

  return roles.some((role) => held.includes(role));
}

/** Whether the user has ALL of the given roles. */
export async function hasAllRoles(
  user: Auth,
  roles: string[],
  tenant?: string,
): Promise<boolean> {
  const held = await rolesFor(user, tenant);

  return roles.every((role) => held.includes(role));
}

/**
 * The access facade — every check plus `flush` to drop a user's cached set.
 * Role assignment lives on the ejected `UserRole` model in app-land; callers do
 * `UserRole.assign(...)` then `access.flush(user, tenant)`.
 *
 * @example
 * import { access } from "@warlock.js/access";
 * if (await access.can(user, "orders.update", { resource: order })) { ... }
 * await access.flush(user, "tenant-1");
 */
export const access = {
  can,
  cannot,
  canAll,
  canAny,
  authorize,
  authorizeAll,
  authorizeAny,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  /** Drop the user's cached role/permission set (call after you mutate role rows). */
  flush: flushUser,
};
