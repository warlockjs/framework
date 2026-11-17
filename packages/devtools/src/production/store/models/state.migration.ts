import { migrate } from "@warlock.js/cascade";
import { DevtoolsStateRow } from "./state.model";

export const DevtoolsStateMigration = migrate(DevtoolsStateRow, {
  name: "devtoolsState",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.boolean("disabled").default(false);
    this.string("disabled_path_hash", 64).nullable();
    this.bigInteger("disabled_at").nullable();
    this.string("disabled_by", 64).nullable();
    this.bigInteger("locked_until").nullable();
    this.bigInteger("failures_reset_at").nullable();
    this.bigInteger("updated_at");
    this.integer("version").default(0);
  },
  down() {
    this.dropTableIfExists();
  },
});
