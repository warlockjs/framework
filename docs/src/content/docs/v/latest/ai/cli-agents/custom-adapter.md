---
title: "Write a CLI adapter"
description: "The CliAdapter interface of @warlock.js/ai-cli — a launch plan plus a stream parser — for driving a coding CLI the package does not ship."
sidebar:
  order: 4
  label: "Write an adapter"
---

An adapter is a plain object with two jobs:

- **`plan(context)`** turns a run into argv, an optional stdin text, environment variables and the files to write.
- **`parser(context)`** turns the CLI's stdout lines into the [unified events](../run-cli-agents/#the-event-model).

The runner owns everything else: executable lookup, the Windows rules, the capability probe, the config home, secrets, process-tree cancellation and the result. So an adapter stays small.

```ts
import {
  cli,
  jsonLinesParser,
  jsonFile,
  mcpServersJson,
  stringField,
  usageOf,
  numberField,
  type CliAdapter,
  type CliLaunchFile,
} from "@warlock.js/ai-cli";
import path from "node:path";

export const acmeAdapter: CliAdapter = {
  name: "acme",
  title: "Acme Agent",
  command: "acme",
  apiKeyEnv: ["ACME_API_KEY"], // `apiKey` is exported as the first one
  homeEnv: ["ACME_HOME"], // pointed at the run's home; [] if the CLI cannot relocate its config
  transports: ["argv", "stdin"], // in order of preference
  effort: false, // true when plan() maps `effort`
  mcp: true, // true when plan() renders `mcp`
  probe: { help: [["run", "--help"]], version: ["--version"] },
  verification: {
    version: "3.2.0",
    verifiedBy: "help",
    sources: ["https://acme.dev/docs/cli"],
    checkedAt: "2026-10-17",
  },
  plan(context) {
    const args = ["run", "--json"];
    const requires = ["--json"]; // every flag below must appear in `acme run --help`
    const files: CliLaunchFile[] = [];

    if (context.model) {
      args.push("--model", context.model);
      requires.push("--model");
    }

    if (context.resume) {
      args.push("--resume", context.resume);
      requires.push("--resume");
    }

    if (context.permission === "bypass") {
      args.push("--yes-to-all");
      requires.push("--yes-to-all");
    }

    if (context.mcp) {
      const file = path.join(context.runDir, "mcp.json"); // written 0600, removed after the run
      files.push({ path: file, content: jsonFile({ mcpServers: mcpServersJson(context.mcp) }) });
      args.push("--mcp-config", file);
      requires.push("--mcp-config");
    }

    return {
      args,
      tail: context.transport === "argv" ? [context.prompt] : [], // after caller `args`
      stdin: context.transport === "stdin" ? context.prompt : undefined,
      env: context.home ? { ACME_HOME: context.home } : undefined,
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

const acme = cli.custom(acmeAdapter, { permission: "standard" });
const result = await (await acme.run("Add a health check endpoint", { cwd: "/srv/api" })).done();
```

## The launch context

`plan()` and `parser()` receive a `CliLaunchContext`:

| Field                                            | Meaning                                                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`                                         | The prompt text.                                                                                                                              |
| `transport`                                      | `"argv"`, `"stdin"` or `"file"` — where this plan must put the prompt.                                                                        |
| `cwd`                                            | Absolute working directory (also the process cwd).                                                                                            |
| `model`, `effort`, `resume`, `permission`, `mcp` | The run's options, already validated.                                                                                                         |
| `apiKey`                                         | The run's key — only read it when the CLI insists on a key file.                                                                              |
| `home`                                           | The config home, or `undefined` for `home: "inherit"`.                                                                                        |
| `homeIsPrivate`                                  | `true` when `home` was created for this run; only then may you write home-level config files (`requirePrivateHome()` fails closed otherwise). |
| `runDir`                                         | Private per-run directory (0700) for run-scoped files; deleted after the run.                                                                 |
| `platform`                                       | `process.platform` of the host.                                                                                                               |

## Rules for a good adapter

- **List every flag you use in `requires`**, spelled as `--help` prints it. That keeps a CLI release with renamed flags failing closed. Omit only flags the CLI accepts but no longer documents, and say so in a comment.
- **Never put a secret in `args` or `tail`.** Use `env`, or a file in `runDir` or a private home.
- **Use `argvPrompt(prompt)`** for a positional prompt, so a prompt starting with `-` is not read as a flag. Use `promptFile(context)` for a `"file"` transport.
- **Map `effort` with `mapEffort(effort, levels)`**, so every adapter follows the framework clamping rule.
- **Throw `unsupportedOption(adapter, message)`** for an option the CLI cannot honour, rather than silently dropping it.
- **Report vendor failures as `error` events with `fatal: true`**, so a CLI that exits 0 after a failure still ends `failed`.
- **For a session id revealed only at the end,** return it from the parser's `sessionRef()`.
- **For data the CLI writes to a file** (a usage report, an export), point the CLI at `context.runDir` and read the file in the parser's `end()`. The run directory is removed only after `end()`.
- **Record `verification`** — the version, the sources, and whether you checked the real `--help` or only the docs.

Helpers exported for adapters: `jsonLinesParser`, `parseJsonLine`, `asRecord`, `asArray`, `stringField`, `numberField`, `recordField`, `outputText`, `parseArguments`, `usageOf`, `anthropicUsage`, `mcpServersJson`, `jsonFile`, `dotenvFile`, `toToml`, `mapEffort`, `argvPrompt`, `promptFile`, `requirePrivateHome`, `unsupportedOption` and `createClaudeStreamParser`. The last one parses Claude Code's `stream-json` format, which several CLIs reproduce.

## Test an adapter

Record a real stream once (or build one from the vendor's documented examples) and parse it in a unit test; no CLI needs to be installed:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { acmeAdapter } from "./acme-adapter";

it("normalizes a recorded Acme stream", () => {
  const parser = acmeAdapter.parser({} as never);
  const events = readFileSync("fixtures/acme/stream.jsonl", "utf8")
    .split("\n")
    .flatMap((line) => parser.line(line));

  expect(events[0]).toMatchObject({ type: "session.started" });
  expect(events.some((event) => event.type === "tool.call")).toBe(true);
});
```

`helpLists(help, flag)` and `missingFlags(help, flags)` check a plan's `requires` against a recorded `--help`.
