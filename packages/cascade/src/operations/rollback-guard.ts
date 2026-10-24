import readline from "node:readline";
import type { DestructiveOperation } from "../migration/migration";
import { migrationRunner } from "../migration/migration-runner";
import type { RollbackPlan } from "../migration/types";
import type { RollbackMigrationsOptions } from "./migrations";

/**
 * Options for {@link confirmRollback}.
 */
export type ConfirmRollbackOptions = RollbackMigrationsOptions & {
  /**
   * Development keeps the unprompted flow (the summary is still printed).
   * Defaults to `NODE_ENV === "development"`; anything else, including an
   * unset `NODE_ENV`, counts as not development.
   */
  readonly development?: boolean;
  /** `--yes` / `--force`: confirm without asking. Required when there is no terminal. */
  readonly yes?: boolean;
  /** Whether a person can answer a prompt. Defaults to both stdin and stdout being a TTY. */
  readonly interactive?: boolean;
  /** Ask the question and resolve with the answer. Defaults to a `readline` prompt. */
  readonly confirm?: (question: string) => Promise<boolean>;
  /** Where the summary goes. Defaults to `console.log`. */
  readonly print?: (line: string) => void;
};

/**
 * Whether a plan removes data: an operation the rollback will actually apply.
 * Ledger-only rollbacks and skipped document-store drops are not destructive.
 */
export function hasDestructiveOperations(plan: RollbackPlan): boolean {
  return plan.some((entry) => entry.operations.some((operation) => operation.applied));
}

function describeOperation(operation: DestructiveOperation): string {
  const noun = operation.store === "document" ? "collection" : "table";
  const unit = operation.store === "document" ? "document(s)" : "row(s)";
  const fieldNoun = operation.store === "document" ? "field(s)" : "column(s)";
  const count = operation.count === undefined ? "" : ` [${operation.count} ${unit}]`;

  if (operation.type === "dropFields") {
    const verb = operation.store === "document" ? "unset" : "drop";
    const names = (operation.fields ?? []).join(", ");

    return operation.applied
      ? `${verb} ${fieldNoun} ${names} on ${noun} "${operation.table}"${count}`
      : `SKIPPED ${verb} of ${fieldNoun} ${names} on ${noun} "${operation.table}" (no { destructive: true })`;
  }

  if (operation.type === "truncateTable") {
    return `remove every ${operation.store === "document" ? "document" : "row"} from ${noun} "${operation.table}"${count}`;
  }

  return `drop ${noun} "${operation.table}"${count}`;
}

/**
 * Render a rollback plan as the destructive-operation summary lines.
 *
 * @example
 * formatRollbackPlan(plan).forEach((line) => console.log(line));
 */
export function formatRollbackPlan(plan: RollbackPlan): string[] {
  const lines: string[] = [];
  let ledgerOnly = 0;

  for (const entry of plan) {
    if (entry.operations.length === 0) {
      ledgerOnly++;
      continue;
    }

    lines.push(`  ${entry.name}`);

    for (const operation of entry.operations) {
      lines.push(`    - ${describeOperation(operation)}`);
    }
  }

  if (ledgerOnly > 0) {
    lines.push(`  ${ledgerOnly} migration(s) only update the migrations ledger (no data removed).`);
  }

  return lines;
}

async function askOnTerminal(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`${question} (y/N): `, (answer) => {
      rl.close();
      resolve(["y", "yes"].includes(answer.trim().toLowerCase()));
    });
  });
}

/**
 * Print what a rollback would remove and decide whether it may proceed.
 *
 * - Always prints the per-migration summary (collections/tables, fields/columns,
 *   document/row counts where the driver can count them).
 * - A plan that removes nothing proceeds without a question.
 * - In development it proceeds after printing.
 * - Elsewhere it asks for confirmation, or proceeds with `yes`. With no terminal
 *   and no `yes` it throws instead of guessing.
 *
 * Returns `false` when the person declined. Call it before `rollbackMigrations()`
 * (and before `freshMigrate()`, with `all: true`).
 *
 * @example
 * if (await confirmRollback({ all: true, yes: args.yes })) {
 *   await rollbackMigrations({ all: true });
 * }
 */
export async function confirmRollback(options: ConfirmRollbackOptions = {}): Promise<boolean> {
  const print = options.print ?? ((line: string) => console.log(line));
  const development = options.development ?? process.env.NODE_ENV === "development";
  const batches = options.all ? Number.POSITIVE_INFINITY : (options.batches ?? 1);

  const plan = await migrationRunner.planRollback(batches);

  if (plan.length === 0) return true;

  print("\nRollback plan:");
  formatRollbackPlan(plan).forEach(print);
  print("");

  if (!hasDestructiveOperations(plan) || development || options.yes) return true;

  const interactive = options.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!interactive) {
    throw new Error(
      "Refusing to roll back: this rollback removes data and there is no terminal to confirm it. " +
        "Review the summary above, then re-run with --yes (or --force).",
    );
  }

  return (options.confirm ?? askOnTerminal)("This rollback removes the data listed above. Continue?");
}
