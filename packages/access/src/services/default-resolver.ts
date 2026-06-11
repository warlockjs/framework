import type { Auth } from "@warlock.js/auth";
import type { AccessResolver } from "../contracts/access-resolver";
import type { RolesMap } from "../contracts/types";

/** Coerce a roles value (`undefined` / single string / array) into a string array. */
function toRoleList(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];

  if (typeof value === "string" && value.length > 0) return [value];

  return [];
}

/**
 * The zero-config resolver: reads a user's roles from a model field and maps
 * them to permissions through your `roles` catalog. Works out of the box for
 * both a `roles` array column and a single `role` column.
 *
 * Swap `readRoles` to read from anywhere else (a relation, a token claim); for
 * a different storage shape entirely, implement {@link AccessResolver} directly.
 *
 * @example
 * new DefaultAccessResolver({ editor: ["orders.*"], viewer: ["orders.view"] });
 * new DefaultAccessResolver(rolesMap, (user) => user.get("memberRoles"));
 */
export class DefaultAccessResolver implements AccessResolver {
  public constructor(
    private readonly roles: RolesMap,
    private readonly readRoles: (user: Auth) => unknown = (user) =>
      user.get("roles") ?? user.get("role"),
  ) {}

  public async rolesOf(user: Auth): Promise<string[]> {
    return toRoleList(await this.readRoles(user));
  }

  public async permissionsOf(user: Auth): Promise<string[]> {
    const roles = await this.rolesOf(user);

    // Guard against a role named `__proto__` / `constructor` resolving to an
    // inherited (non-array) value.
    return roles.flatMap((role) =>
      Object.prototype.hasOwnProperty.call(this.roles, role) ? this.roles[role] : [],
    );
  }
}
