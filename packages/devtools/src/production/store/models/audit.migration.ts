import { migrate } from "@warlock.js/cascade";
import { DevtoolsAuditRow } from "./audit.model";

export const DevtoolsAuditMigration = migrate(DevtoolsAuditRow, {
  name: "devtoolsAudit",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.string("type", 64);
    this.bigInteger("occurred_at").index();
    this.string("account_id", 64).nullable();
    this.string("email", 320).nullable();
    this.string("ip", 64).nullable();
    this.string("user_agent", 255).nullable();
    this.json("detail");
    this.string("ref", 16);

    this.index(["type", "occurred_at"]);
    this.index(["ip", "occurred_at"]);
    this.index(["account_id", "occurred_at"]);
  },
  down() {
    this.dropTableIfExists();
  },
});
