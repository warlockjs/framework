import { migrateAction } from "../../database/migrate-action";
import { command } from "../cli-command";

export const migrateCommand = command({
  action: migrateAction,
  name: "migrate",
  description: "Run database migrations",
  preload: {
    config: ["database", "log"],
    env: true,
    connectors: ["database"],
  },
  options: [
    {
      text: "--fresh, -f",
      description: "Drop all tables and re-run migrations",
      type: "boolean",
    },
    {
      text: "--rollback, -r",
      description: "Rollback migrations, drop all tables",
      type: "boolean",
    },
    {
      text: "--path, -p",
      description: "Migration file path, if not provided, all migrations will be wroking",
      type: "string",
    },
    {
      text: "--list, -l",
      description: "List all executed migrations",
      type: "boolean",
    },
    {
      text: "--all, -a",
      description: "List all migrations files in the app",
      type: "boolean",
    },
  ],
});
