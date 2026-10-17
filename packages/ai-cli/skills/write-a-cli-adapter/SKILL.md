---
name: write-a-cli-adapter
description: 'Write a CliAdapter for a coding CLI that @warlock.js/ai-cli does not ship. Triggers: `CliAdapter`, `CliLaunchContext`, `CliLaunchPlan`, `CliStreamParser`, `cli.custom`, `createCliAgent`, `jsonLinesParser`, `stringField`, `numberField`, `usageOf`, `mcpServersJson`, `jsonFile`, `toToml`, `mapEffort`, `argvPrompt`, `promptFile`, `requirePrivateHome`, `unsupportedOption`, `createClaudeStreamParser`, `helpLists`, `missingFlags`, `requires`, `verification`; ''add a new coding CLI'', ''support another agent CLI'', ''parse a vendor JSONL stream'', ''adapter for a new CLI version''; typical import `import { cli, jsonLinesParser, type CliAdapter } from "@warlock.js/ai-cli"`. Skip: using the built-in adapters — the `run-cli-agents` topic.'
---

# Write a CLI adapter

An adapter is a plain object with two jobs: `plan(context)` builds argv, stdin, environment and files for one run, and `parser(context)` turns stdout lines into the unified events. The runner does the rest: executable lookup, the Windows `.cmd` rules, the capability probe, homes, secrets, cancellation and the result.

```ts
import path from "node:path";
import {
  cli,
  jsonFile,
  jsonLinesParser,
  mcpServersJson,
  numberField,
  stringField,
  usageOf,
  type CliAdapter,
  type CliLaunchFile,
} from "@warlock.js/ai-cli";

export const acmeAdapter: CliAdapter = {
  name: "acme",
  title: "Acme Agent",
  command: "acme",
  apiKeyEnv: ["ACME_API_KEY"],
  homeEnv: ["ACME_HOME"],
  transports: ["argv", "stdin"],
  effort: false,
  mcp: true,
  probe: { help: [["run", "--help"]], version: ["--version"] },
  verification: {
    version: "3.2.0",
    verifiedBy: "help",
    sources: ["https://acme.dev/docs/cli"],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["run", "--json"];
    const requires = ["--json"];
    const files: CliLaunchFile[] = [];

    if (context.model !== undefined) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.resume !== undefined) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--yes-to-all");
      requires.push("--yes-to-all");
    }

    if (context.mcp !== undefined) {
      const file = path.join(context.runDir, "mcp.json");

      files.push({ path: file, content: jsonFile({ mcpServers: mcpServersJson(context.mcp) }) });
      args.push("--mcp-config", file);
      requires.push("--mcp-config");
    }

    return {
      args,
      tail: context.transport === "argv" ? [context.prompt] : [],
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env: context.home !== undefined ? { ACME_HOME: context.home } : undefined,
      files,
      requires,
    };
  },
  parser: () =>
    jsonLinesParser((record) => {
      switch (record.type) {
        case "start":
          return [{ type: "session.started", sessionRef: stringField(record, "id") }];
        case "text":
          return [{ type: "message", text: stringField(record, "text") ?? "", delta: true }];
        case "tool":
          return [
            {
              type: "tool.call",
              id: String(record.id),
              name: String(record.name),
              input: record.input,
            },
          ];
        case "tool_done":
          return [
            {
              type: "tool.result",
              id: String(record.id),
              output: String(record.output),
              isError: record.ok !== true,
            },
          ];
        case "usage":
          return [
            {
              type: "usage",
              cumulative: true,
              usage: usageOf({
                input: numberField(record, "in"),
                output: numberField(record, "out"),
              }),
            },
          ];
        case "error":
          return [{ type: "error", message: String(record.message), fatal: true }];
        default:
          return [];
      }
    }),
};

const acme = cli.custom(acmeAdapter);
const result = await (await acme.run("Add a health check endpoint", { cwd: "/srv/api" })).done();

console.log(result.status, result.text);
```

## Rules

- **`requires`:** list every flag and subcommand the plan uses, spelled as `--help` prints it. The probe then fails the run up front, naming the flag and the installed version, if a release drops or renames one. Leave out only a flag the CLI accepts but no longer documents, and say so in a comment.
- **Secrets:** never put one in `args` or `tail`. Use `env`, or a file under `context.runDir` (written 0600, removed after the run). A home-level config file may be written only when `context.homeIsPrivate`; `requirePrivateHome(context, adapter, "MCP servers")` fails closed otherwise.
- **Prompt placement:** `tail` goes after the caller's `args`. Wrap a positional prompt in `argvPrompt(prompt)`, so a prompt starting with `-` is not read as a flag. For a `"file"` transport, `promptFile(context)` writes the prompt into the run directory.
- **Effort:** `mapEffort(effort, { low: "low", high: "high" })` follows the framework clamping rule. Set `effort: true` only when you map it. The runner refuses `effort` for adapters that do not.
- **Unsupported options:** `throw unsupportedOption(adapter, "why")` for an option the CLI cannot honour; never drop it silently.
- **Failures:** report a vendor failure as `{ type: "error", fatal: true }`, so a CLI that exits 0 still ends `failed`.
- **Late session ids:** if the id arrives only at the end, return it from the parser's `sessionRef()`. If the CLI writes its result to a file, point it at `context.runDir` and read the file in the parser's `end()`.
- **Claude-style streams:** for a CLI that reproduces Claude Code's `stream-json`, reuse `createClaudeStreamParser({ usage: "anthropic" | "inclusive" })`.
- **Verification:** record `verification` — the version, the sources, and `"help"` or `"docs"`.

## Test without the real CLI

```ts
// acme-adapter.spec.ts — `acmeAdapter` from above; `readFileSync` from "node:fs",
// `missingFlags` from "@warlock.js/ai-cli", `expect`/`it` from "vitest".
it("normalizes a recorded stream and needs only listed flags", () => {
  const parser = acmeAdapter.parser({
    prompt: "x",
    transport: "argv",
    cwd: "/work",
    permission: "standard",
    homeIsPrivate: true,
    runDir: "/tmp/run",
    platform: "linux",
  });
  const events = readFileSync("fixtures/acme/stream.jsonl", "utf8")
    .split("\n")
    .flatMap((line) => parser.line(line));

  expect(events[0]).toMatchObject({ type: "session.started" });

  const plan = acmeAdapter.plan({
    prompt: "x",
    transport: "argv",
    cwd: "/work",
    model: "fast",
    permission: "bypass",
    homeIsPrivate: true,
    runDir: "/tmp/run",
    platform: "linux",
  });

  expect(missingFlags(readFileSync("fixtures/acme/help.txt", "utf8"), plan.requires)).toEqual([]);
});
```
