import type { Auth } from "@warlock.js/auth";
import type { AccessResolver } from "../contracts/access-resolver";
import type { RolesMap } from "../contracts/types";
import { UserRole } from "../models/user-role.model";

/**
 * A resolver backed by the {@link UserRole} assignment table: roles come from
 * the table (multi-role, tenant-aware); permissions are mapped through your
 * `roles` catalog. Pass a custom model to point at a different table.
 *
 * @example
 * new ModelAccessResolver({ editor: ["orders.*"] });
 * new ModelAccessResolver(rolesMap, AppUserRole);
 */
export class ModelAccessResolver implements AccessResolver {
  public constructor(
    private readonly roles: RolesMap,
    private readonly model: typeof UserRole = UserRole,
  ) {}

  public async rolesOf(user: Auth, tenant?: string): Promise<string[]> {
    return this.model.rolesFor(user, tenant);
  }

  public async permissionsOf(user: Auth, tenant?: string): Promise<string[]> {
    const roles = await this.rolesOf(user, tenant);

    return roles.flatMap((role) =>
      Object.prototype.hasOwnProperty.call(this.roles, role) ? this.roles[role] : [],
    );
  }
}
