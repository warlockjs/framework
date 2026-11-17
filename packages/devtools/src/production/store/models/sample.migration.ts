import { migrate } from "@warlock.js/cascade";
import { DevtoolsSampleRow } from "./sample.model";

export const DevtoolsSamplesMigration = migrate(DevtoolsSampleRow, {
  name: "devtoolsSamples",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.string("instance", 128).index();
    this.bigInteger("started_at").index();
    this.integer("status").nullable().index();
    this.string("method", 16);
    this.text("path");
    this.json("summary");
    // JSON text: request data may hold keys MongoDB cannot store as field names.
    this.longText("detail").nullable();
  },
  down() {
    this.dropTableIfExists();
  },
});
