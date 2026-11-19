import { migrate } from "@warlock.js/cascade";
import { DEVTOOLS_AI_ERROR_CATEGORIES, DEVTOOLS_AI_LATENCY_BUCKETS_MS } from "../../contracts";
import { DevtoolsAiRollupRow } from "./ai-rollup.model";

export const DevtoolsAiRollupsMigration = migrate(DevtoolsAiRollupRow, {
  name: "devtoolsAiRollups",
  up() {
    this.createTableIfNotExists();

    // The id is `rollupId(key)`; `unique` also covers MongoDB, which ignores primary keys.
    this.string("id", 64).primary().unique();

    this.bigInteger("hour").index();
    this.string("agent", 200).index();
    this.string("model", 200).index();
    this.string("provider", 100);

    for (const column of ["runs", "completed", "failed", "incomplete", "cancelled"]) {
      this.integer(column).default(0);
    }

    for (const column of [
      "input_tokens",
      "output_tokens",
      "cached_tokens",
      "cache_write_tokens",
      "reasoning_tokens",
    ]) {
      this.bigInteger(column).default(0);
    }

    this.double("cost_usd").default(0);
    this.integer("priced_runs").default(0);
    this.integer("unpriced_runs").default(0);
    this.bigInteger("unpriced_tokens").default(0);
    this.integer("fallback_runs").default(0);
    this.integer("refusals").default(0);

    for (const category of DEVTOOLS_AI_ERROR_CATEGORIES) {
      this.integer(`err_${category.replaceAll("-", "_")}`).default(0);
    }

    for (let index = 0; index <= DEVTOOLS_AI_LATENCY_BUCKETS_MS.length; index++) {
      this.integer(`lat_${index}`).default(0);
    }

    this.integer("latency_count").default(0);
    this.double("latency_sum_ms").default(0);
    this.bigInteger("updated_at");
  },
  down() {
    this.dropTableIfExists();
  },
});
