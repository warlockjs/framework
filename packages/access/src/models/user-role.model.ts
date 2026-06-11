import type { Auth } from "@warlock.js/auth";
import { Model } from "@warlock.js/cascade";
import { v } from "@warlock.js/seal";

/**
 * Seal schema for a role assignment. Exported so an override can spread it and
 * add columns without re-declaring the base shape:
 *
 * @example
 * export class AppUserRole extends UserRole {
 *   public static schema = userRoleSchema.extend({ granted_by: v.scalar().optional() });
 * }
 */
export const userRoleSchema = v.object({
  user_id: v.scalar().required(),
  user_type: v.string().required(),
  role: v.string().required(),
  tenant: v.string().optional(),
});

/**
 * The default assignment table — which roles a user holds, optionally per
 * tenant. Backs {@link ModelAccessResolver}. The service drives it through
 * named statics, so an override can rename/add columns by extending this class
 * and pointing the resolver at it.
 */
export class UserRole extends Model {
  public static table = "user_roles";

  public static schema = userRoleSchema;

  /**
   * Role names assigned to the user in the given tenant.
   *
   * An unresolved tenant (`undefined`) scopes to GLOBAL roles only — the rows
   * stored with no tenant (`null`) — never the union across every tenant. The
   * union would be a privilege-escalation: a user who is `owner` in one tenant
   * must not be treated as `owner` everywhere just because a check didn't carry
   * a tenant. This mirrors how `assign(user, role)` stores a global row.
   */
  public static async rolesFor(user: Auth, tenant?: string): Promise<string[]> {
    // Read rows and map the field rather than `pluck("role")` — pluck drops the
    // value on Postgres when the filter carries the extra `tenant` key.
    const rows = await this.query()
      .where({
        user_id: user.id,
        user_type: user.userType,
        tenant: tenant ?? null,
      })
      .get();

    // De-dupe so a duplicate row (a concurrent assign that slipped past the
    // existence check) can't distort the resolved set.
    return [...new Set(rows.map((row) => row.get("role") as string))];
  }

  /** Assign a role to the user. No-op if the assignment already exists. */
  public static async assign(user: Auth, role: string, tenant?: string): Promise<void> {
    const existing = await this.first({
      user_id: user.id,
      user_type: user.userType,
      role,
      tenant: tenant ?? null,
    });

    if (existing) return;

    await this.create({
      user_id: user.id,
      user_type: user.userType,
      role,
      tenant,
    });
  }

  /** Remove a role assignment from the user. */
  public static async revoke(user: Auth, role: string, tenant?: string): Promise<void> {
    await this.delete({
      user_id: user.id,
      user_type: user.userType,
      role,
      tenant: tenant ?? null,
    });
  }
}
