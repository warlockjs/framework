import { migrate } from "@warlock.js/cascade";
import { DevtoolsAccountRow } from "./account.model";

export const DevtoolsAccountsMigration = migrate(DevtoolsAccountRow, {
  name: "devtoolsAccounts",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.string("email", 320).unique();
    this.string("role", 16);
    this.text("password_hash");
    this.string("password_source", 32);
    this.boolean("must_change_password").default(false);
    this.text("totp_secret").nullable();
    this.bigInteger("totp_enabled_at").nullable();
    this.bigInteger("totp_last_step").nullable();
    this.json("recovery_codes");
    this.json("passkeys");
    this.bigInteger("failures_reset_at").nullable();
    this.bigInteger("created_at");
    this.bigInteger("updated_at");
    this.bigInteger("last_login_at").nullable();
    this.string("created_by", 64).nullable();
    this.integer("version").default(1);
  },
  down() {
    this.dropTableIfExists();
  },
});
