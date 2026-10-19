import { glob } from "glob";
import { resolve } from "node:path";
import { command } from "../../commands/cli-command";
import type { CommandActionData } from "../../commands/types";
import { loadE2ESpec } from "./load-e2e-spec";
import type { RunE2EOptions } from "../../e2e/types";

export function readE2EOptions({ options }: CommandActionData): RunE2EOptions {
  return {
    browser: typeof options.browser === "string" ? options.browser : undefined,
    outputDirectory: typeof options.out === "string" ? options.out : undefined,
    path:
      typeof options.path === "string"
        ? options.path
            .split(",")
            .filter(Boolean)
            .map((path) => resolve(path))
        : undefined,
  };
}

export async function e2eCommandAction(data: CommandActionData): Promise<void> {
  const patterns = data.args.length ? data.args : ["e2e/**/*.e2e.{ts,mts,js,mjs}"];
  const files = [
    ...new Set(
      await glob(patterns, {
        absolute: true,
        nodir: true,
        ignore: ["**/node_modules/**", "**/.warlock/**"],
      }),
    ),
  ].sort();
  if (!files.length)
    throw new Error(
      `No browser e2e specs found: ${patterns.join(", ")}. Create e2e/example.e2e.ts exporting defineE2E({ app, run }).`,
    );
  const { runE2E } = await import("../../e2e/run-e2e");
  const failures: unknown[] = [];
  for (const file of files) {
    try {
      const loaded = await loadE2ESpec(file);
      try {
        const result = await runE2E(loaded.spec, readE2EOptions(data));
        console.log(`PASS ${file}\nEvidence: ${result.evidenceFile}`);
      } finally {
        await loaded.dispose();
      }
    } catch (error) {
      failures.push(error);
      console.error(`FAIL ${file}\n${String(error)}`);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `${failures.length} browser e2e spec(s) failed`);
}

export const e2eCommand = command({
  name: "e2e [specs...]",
  description: "Run owned Chrome/Edge browser specs over CDP; write screenshots and evidence JSON",
  action: e2eCommandAction,
  options: [
    {
      text: "--browser",
      description: "Chrome/Edge executable path (or WARLOCK_E2E_BROWSER)",
      type: "string",
    },
    {
      text: "--out",
      description: "Evidence parent directory (default .warlock/e2e)",
      type: "string",
    },
    {
      text: "--path",
      description: "Comma-separated fake-binary directories prepended to app PATH",
      type: "string",
    },
  ],
});
