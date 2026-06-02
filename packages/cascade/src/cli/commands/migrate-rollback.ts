import { defineCommand } from "citty";
import { rollbackMigrations } from "../../operations/migrations";
import { loadMigrations } from "../load-migrations";
import { printRunSummary } from "../printers";
import { withCliConnection } from "../with-cli-connection";

/**
 * `cascade migrate:rollback` — undo the most recent batch (or every executed
 * migration with `--all`). Migration files are loaded so the runner has the
 * `down()` methods available.
 */
export const migrateRollbackCommand = defineCommand({
  meta: {
    name: "migrate:rollback",
    description: "Roll back the most recent batch — or everything with --all.",
  },
  args: {
    all: {
      type: "boolean",
      alias: "a",
      description: "Roll back every executed migration. Overrides --batches.",
      default: false,
    },
    batches: {
      type: "string",
      description: "Roll back the last N batches (ignored when --all is set). Default: 1.",
    },
    path: {
      type: "string",
      alias: "p",
      description: "Glob pattern overriding the default ./migrations/**/*.{ts,js,mjs,cjs}.",
    },
  },
  async run({ args }) {
    await withCliConnection(async () => {
      await loadMigrations(args.path);

      const batches = args.batches ? Number(args.batches) : undefined;

      if (batches !== undefined && (!Number.isFinite(batches) || batches <= 0)) {
        throw new Error(
          `Cascade CLI: --batches must be a positive integer, received "${args.batches}".`,
        );
      }

      const results = await rollbackMigrations({
        all: Boolean(args.all),
        batches,
      });

      printRunSummary(results);
    });
  },
});
