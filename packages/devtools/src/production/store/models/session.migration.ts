import { migrate } from "@warlock.js/cascade";
import { DevtoolsSessionRow } from "./session.model";

export const DevtoolsSessionsMigration = migrate(DevtoolsSessionRow, {
  name: "devtoolsSessions",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.string("token_hash", 64).unique();
    this.string("account_id", 64).index();
    this.string("stage", 32);
    this.string("csrf_secret", 128);
    this.bigInteger("created_at");
    this.bigInteger("last_seen_at");
    this.bigInteger("expires_at").index();
    this.string("ip", 64).nullable();
    this.string("user_agent", 255).nullable();
    this.text("pending_totp_secret").nullable();
    this.text("challenge").nullable();
    this.bigInteger("challenge_expires_at").nullable();
    this.integer("version").default(1);
  },
  down() {
    this.dropTableIfExists();
  },
});
