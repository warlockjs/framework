import { migrate } from "@warlock.js/cascade";
import { DevtoolsReportRow } from "./report.model";

export const DevtoolsReportsMigration = migrate(DevtoolsReportRow, {
  name: "devtoolsReports",
  up() {
    this.createTableIfNotExists();

    // The id is a string the store supplies; `unique` also covers MongoDB,
    // which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.bigInteger("seen_at").index();
    // JSON text, up to 256 KB.
    this.longText("data");
  },
  down() {
    this.dropTableIfExists();
  },
});
