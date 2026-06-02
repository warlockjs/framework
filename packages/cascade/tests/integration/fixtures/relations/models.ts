/**
 * Shared relation fixtures for the cascade integration suites (Postgres +
 * MongoDB). Every model is decorated with `@RegisterModel()` so the string
 * relation references resolve through the global registry, and the relation
 * decorators stash their definitions onto each class's static `relations` map.
 *
 * Table / collection names are namespaced with a `rel_` prefix so they never
 * clash with the sibling CRUD suite's `integration_users` table.
 *
 * The relation graph exercised here:
 *
 *   RelUser  ──hasMany──▶  RelPost      (FK rel_post.rel_user_id, inferred)
 *   RelUser  ──hasOne───▶  RelProfile   (FK rel_profile.rel_user_id, inferred)
 *   RelUser  ──belongsToMany──▶ RelRole (pivot rel_role_rel_user, inferred)
 *   RelUser  ──belongsToMany──▶ RelSkill (pivot + columns OVERRIDDEN)
 *   RelPost  ──belongsTo─▶  RelUser      (FK rel_post.rel_user_id, explicit)
 *   RelPost  ──hasMany───▶  RelComment   (FK rel_comment.rel_post_id, inferred)
 *   RelComment ─belongsTo▶  RelPost      (FK rel_comment.rel_post_id, explicit)
 *
 * `hasMany` / `hasOne` rely on the DEFAULT foreign-key convention
 * (`inferHasForeignKey("RelUser")` → `rel_user_id`). `belongsTo` sets an
 * explicit `foreignKey` so it shares that same column — which also covers the
 * explicit-override branch. The `RelRole` pivot is fully inferred; the
 * `RelSkill` pivot overrides every name to cover the override branch.
 */
import { Model } from "../../../../src/model/model";
import {
  BelongsTo,
  BelongsToMany,
  HasMany,
  HasOne,
} from "../../../../src/model/relation-decorators";
import { RegisterModel } from "../../../../src/model/register-model";

export const USERS_TABLE = "rel_users";
export const POSTS_TABLE = "rel_posts";
export const PROFILES_TABLE = "rel_profiles";
export const COMMENTS_TABLE = "rel_comments";
export const ROLES_TABLE = "rel_roles";
export const SKILLS_TABLE = "rel_skills";

/** Pivot table inferred alphabetically from `RelRole` + `RelUser`. */
export const ROLE_USER_PIVOT = "rel_role_rel_user";

/** Pivot table explicitly overridden on the `skills` relation. */
export const USER_SKILLS_PIVOT = "rel_user_skill_links";

@RegisterModel({ name: "RelProfile" })
export class RelProfile extends Model {
  public static table = PROFILES_TABLE;

  @BelongsTo("RelUser", { foreignKey: "rel_user_id" })
  public user?: RelUser;
}

@RegisterModel({ name: "RelComment" })
export class RelComment extends Model {
  public static table = COMMENTS_TABLE;

  @BelongsTo("RelPost", { foreignKey: "rel_post_id" })
  public post?: RelPost;
}

@RegisterModel({ name: "RelRole" })
export class RelRole extends Model {
  public static table = ROLES_TABLE;
}

@RegisterModel({ name: "RelSkill" })
export class RelSkill extends Model {
  public static table = SKILLS_TABLE;
}

@RegisterModel({ name: "RelPost" })
export class RelPost extends Model {
  public static table = POSTS_TABLE;

  @BelongsTo("RelUser", { foreignKey: "rel_user_id" })
  public author?: RelUser;

  @HasMany("RelComment")
  public comments?: RelComment[];
}

@RegisterModel({ name: "RelUser" })
export class RelUser extends Model {
  public static table = USERS_TABLE;

  @HasMany("RelPost")
  public posts?: RelPost[];

  @HasOne("RelProfile")
  public profile?: RelProfile;

  @BelongsToMany("RelRole")
  public roles?: RelRole[];

  @BelongsToMany("RelSkill", {
    pivot: USER_SKILLS_PIVOT,
    localKey: "user_ref",
    foreignKey: "skill_ref",
  })
  public skills?: RelSkill[];
}
