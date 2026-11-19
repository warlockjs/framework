import { DevtoolsRowModel } from "./base";

/** A row of `devtools_ai_rollups`: hourly AI counters per agent, model and provider. */
export class DevtoolsAiRollupRow extends DevtoolsRowModel {
  public static table = "devtools_ai_rollups";
}
