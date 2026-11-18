import { migrate } from "@warlock.js/cascade";
import { DevtoolsShareRow } from "./share.model";

export const DevtoolsSharesMigration = migrate(DevtoolsShareRow, {
  name: "devtoolsShares",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.string("token_hash", 64).unique();
    this.string("panel", 64);
    this.string("label", 80);
    this.string("created_by", 64).nullable();
    this.bigInteger("created_at");
    this.bigInteger("expires_at").index();
    this.bigInteger("revoked_at").nullable();
    this.bigInteger("last_used_at").nullable();
    this.integer("uses").default(0);
  },
  down() {
    this.dropTableIfExists();
  },
});
