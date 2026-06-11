import type { Auth } from "@warlock.js/auth";

/**
 * The one adapter the engine depends on. Implement it to connect the engine to
 * however YOUR app stores roles and permissions — a user column, a pivot table,
 * a token claim, an external directory.
 *
 * The engine owns the hard parts (wildcard matching, caching, policies,
 * fail-closed); the resolver only **fetches**. Keep it dumb — never cache inside
 * it; the engine caches for you.
 *
 * @example
 * export class AppAccessResolver implements AccessResolver {
 *   async rolesOf(user) {
 *     const rows = await UserRole.query().where({ user_id: user.id }).get();
 *     return rows.map((row) => row.get("role") as string);
 *   }
 *   async permissionsOf(user) {
 *     const roles = await this.rolesOf(user);
 *     return roles.flatMap((role) => roleMap[role] ?? []);
 *   }
 * }
 */
export interface AccessResolver {
  /** The role names this user holds (powers `hasRole` / `hasAnyRole`). */
  rolesOf(user: Auth, tenant?: string): Promise<string[]>;

  /** The effective permission strings this user has (powers `can` / `authorize`). */
  permissionsOf(user: Auth, tenant?: string): Promise<string[]>;
}
