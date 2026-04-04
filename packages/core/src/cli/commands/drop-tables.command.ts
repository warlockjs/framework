import { dropTablesAction } from "../../database/drop-tables-action";
import { command } from "../cli-command";

export const dropTablesCommand = command({
  name: "drop.tables",
  description: "Drop all tables in the database",
  action: dropTablesAction,
  preload: {
    config: ["database", "log"],
    env: true,
    connectors: ["database"],
  },
  options: [
    {
      text: "--force, -f",
      description: "Drop tables without confirmation",
      type: "boolean",
    },
  ],
});
