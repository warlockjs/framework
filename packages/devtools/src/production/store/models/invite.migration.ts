import { migrate } from "@warlock.js/cascade";
import { DevtoolsInviteRow } from "./invite.model";

export const DevtoolsInvitesMigration = migrate(DevtoolsInviteRow, {
  name: "devtoolsInvites",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.string("token_hash", 64).unique();
    this.string("email", 320);
    this.string("role", 16);
    this.string("created_by", 64).nullable();
    this.bigInteger("created_at");
    this.bigInteger("expires_at").index();
    this.bigInteger("used_at").nullable();
    this.string("account_id", 64).nullable();
  },
  down() {
    this.dropTableIfExists();
  },
});
