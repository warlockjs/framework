import { migrate } from "@warlock.js/cascade";
import { UserRole } from "./user-role.model";

/**
 * Creates the `user_roles` table. Wire it into `warlock.config.ts`
 * `database.migrations` (the app owns when migrations run). `user_id` defaults
 * to `uuid` — override this migration if your user ids are integers.
 */
export const UserRoleMigration = migrate(UserRole, {
  name: "userRole",
  up() {
    this.createTableIfNotExists();

    this.primaryUuid();

    this.uuid("user_id").index();
    this.string("user_type", 50).notNullable();
    this.string("role", 100).index();
    this.string("tenant", 100).nullable().index();

    // Per-user (per-tenant) lookups go through this composite.
    this.index(["user_id", "user_type", "tenant"]);

    this.timestamps();
  },
  down() {
    this.dropTableIfExists();
  },
});
