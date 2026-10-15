import type { Auth } from "@warlock.js/auth";

/**
 * The one adapter the engine depends on. Implement it to connect the engine to
 * however YOUR app stores roles and permissions — a user column, a pivot table,
 * a token claim, an external directory.
 *
 * The engine owns the hard parts (wildcard matching, caching, policies,
 * fail-closed); the resolver only fetches. Keep it dumb — never cache inside it.
 *
 * @example
 * export class AppAccessResolver implements AccessResolver {
 *   public async resolveRoles(user: Auth, tenant?: string): Promise<string[]> {
 *     const rows = await UserRole.query().where({ user_id: user.id, tenant: tenant ?? null }).get();
 *     return rows.map((row) => row.get("role") as string);
 *   }
 *   public async resolvePermissions(user: Auth, tenant?: string): Promise<string[]> {
 *     const names = await this.resolveRoles(user, tenant);
 *     const roles = await Role.query().whereIn("name", names).get();
 *     return roles.flatMap((role) => role.get("permissions") as string[]);
 *   }
 * }
 */
export interface AccessResolver {
  /** The role names this user holds (powers `hasRole` / `hasAnyRole`). */
  resolveRoles(user: Auth, tenant?: string): Promise<string[]>;

  /** The effective permission strings this user has (powers `can` / `authorize`). */
  resolvePermissions(user: Auth, tenant?: string): Promise<string[]>;

  /**
   * Optional. The ambient tenant for this user when a check doesn't pass one
   * explicitly — commonly derived from the user (e.g. `user.get("organization_id")`),
   * which is safer than trusting client-supplied request input. Return `undefined`
   * for single-tenant apps.
   */
  resolveTenant?(user: Auth): string | undefined;
}
