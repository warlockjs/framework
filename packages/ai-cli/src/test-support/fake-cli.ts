import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { CliAdapter, CliLaunchFile, CliParsedEvent } from "../contracts";
import { jsonFile, mcpServersJson, usageOf } from "../adapters/shared";
import { jsonLinesParser, numberField, stringField } from "../stream/json-lines";

/**
 * Source of a fake coding CLI: a small Node script that prints a help
 * screen, a version, and a JSONL session whose behaviour is chosen by
 * `FAKE_MODE`. Lets the runner be tested end to end with real processes
 * and no vendor binary.
 */
const FAKE_CLI_SOURCE = String.raw`
const fs = require("fs");
const { spawn } = require("child_process");
const args = process.argv.slice(2);
const emit = (record) => process.stdout.write(JSON.stringify(record) + "\n");

if (args[0] === "--version") {
  console.log("fake-cli version 1.4.2 (build 77)");
  process.exit(0);
}

if (args[0] === "--help") {
  process.stdout.write(process.env.FAKE_HELP ||
    "Usage: fake [options] [prompt]\n" +
    "  -p, --print           print mode\n" +
    "  --json                JSONL output\n" +
    "  --model <name>        model\n" +
    "  --effort <level>      effort\n" +
    "  --resume <id>         resume a session\n" +
    "  --mcp-config <file>   MCP servers\n" +
    "  --stdin               read the prompt from stdin\n" +
    "  --yolo                approve everything\n");
  process.exit(0);
}

const mode = process.env.FAKE_MODE || "ok";

const run = (prompt) => {
  const transport = args.includes("--stdin") ? "stdin" : "argv";
  const resumeAt = args.indexOf("--resume");
  emit({ t: "start", id: resumeAt >= 0 ? args[resumeAt + 1] : "sess-1", model: "fake-model" });

  if (mode === "fail") {
    process.stderr.write("boom: invalid credentials\n");
    process.exit(3);
  }

  if (mode === "fatal") {
    emit({ t: "error", message: "quota exhausted" });
    process.exit(0);
  }

  if (mode === "hang") {
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "inherit" });
    fs.writeFileSync(process.env.FAKE_PID_FILE, String(child.pid));
    emit({ t: "text", delta: "working" });
    setInterval(() => {}, 1000);
    return;
  }

  if (mode === "env") {
    emit({ t: "result", text: JSON.stringify({
      argv: args,
      home: process.env.FAKE_HOME || null,
      key: process.env.FAKE_API_KEY || null,
      keep: process.env.KEEP_ME || null,
      other: process.env.OTHER_SECRET || null,
      cwd: process.cwd(),
    }) });
    return;
  }

  if (mode === "mcp") {
    const at = args.indexOf("--mcp-config");
    const file = args[at + 1];
    const stat = fs.statSync(file);
    emit({ t: "result", text: JSON.stringify({ file, mode: (stat.mode & 0o777).toString(8), content: JSON.parse(fs.readFileSync(file, "utf8")) }) });
    return;
  }

  emit({ t: "text", delta: "Hel" });
  emit({ t: "text", delta: "lo" });
  emit({ t: "msg", text: "Hello" });
  emit({ t: "tool", id: "c1", name: "read_file", input: { path: "a.txt" } });
  emit({ t: "tool_result", id: "c1", output: "file body" });
  emit({ t: "msg", text: "Read it." });
  emit({ t: "usage", input: 10, output: 5, cached: 4 });
  emit({ t: "usage", input: 3, output: 2 });
  process.stdout.write("not json banner\n");
  process.stdout.write(JSON.stringify({ t: "result", text: "done:" + prompt.length + ":" + transport }));
};

if (args.includes("--stdin")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => run(input));
} else {
  run(args[args.length - 1] || "");
}
`;

/** Write the fake CLI into a fresh temp directory and return its path. */
export async function writeFakeCli(name = "fake-cli"): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "warlock-fake-cli-"));
  const file = path.join(dir, name);

  await writeFile(file, `#!${process.execPath}\n${FAKE_CLI_SOURCE}`);
  await chmod(file, 0o755);

  return { dir, file };
}

/** Parser for the fake CLI's JSONL. */
function parseFake(record: Record<string, unknown>): CliParsedEvent[] {
  switch (record.t) {
    case "start":
      return [
        {
          type: "session.started",
          sessionRef: stringField(record, "id"),
          model: stringField(record, "model"),
          raw: record,
        },
      ];
    case "text":
      return [{ type: "message", text: stringField(record, "delta") ?? "", delta: true }];
    case "msg":
      return [{ type: "message", text: stringField(record, "text") ?? "", delta: false }];
    case "result":
      return [
        { type: "message", text: stringField(record, "text") ?? "", delta: false, final: true },
      ];
    case "tool":
      return [
        {
          type: "tool.call",
          id: stringField(record, "id") ?? "",
          name: stringField(record, "name") ?? "",
          input: record.input,
        },
      ];
    case "tool_result":
      return [
        {
          type: "tool.result",
          id: stringField(record, "id") ?? "",
          output: stringField(record, "output") ?? "",
          isError: false,
        },
      ];
    case "usage":
      return [
        {
          type: "usage",
          cumulative: false,
          usage: usageOf({
            input: numberField(record, "input"),
            output: numberField(record, "output"),
            cachedTokens: numberField(record, "cached"),
          }),
        },
      ];
    case "error":
      return [{ type: "error", message: stringField(record, "message") ?? "error", fatal: true }];
    default:
      return [];
  }
}

/** An adapter for the fake CLI, exercising every plan feature. */
export function fakeAdapter(command: string): CliAdapter {
  return {
    name: "fake",
    title: "Fake CLI",
    command,
    apiKeyEnv: ["FAKE_API_KEY"],
    homeEnv: ["FAKE_HOME"],
    transports: ["argv", "stdin"],
    effort: true,
    mcp: true,
    probe: { help: [["--help"]], version: ["--version"] },
    verification: {
      version: "1.4.2",
      verifiedBy: "help",
      sources: ["https://example.invalid/fake-cli"],
      checkedAt: "2026-10-17",
    },
    plan(context) {
      const args = ["--print", "--json"];
      const requires = ["--print", "--json"];
      const files: CliLaunchFile[] = [];

      if (context.model !== undefined) {
        args.push("--model", context.model);
        requires.push("--model");
      }

      if (context.effort !== undefined) {
        args.push("--effort", context.effort);
        requires.push("--effort");
      }

      if (context.resume !== undefined) {
        args.push("--resume", context.resume);
        requires.push("--resume");
      }

      if (context.permission === "bypass") {
        args.push("--yolo");
        requires.push("--yolo");
      }

      if (context.mcp !== undefined) {
        const file = path.join(context.runDir, "mcp.json");

        files.push({ path: file, content: jsonFile({ mcpServers: mcpServersJson(context.mcp) }) });
        args.push("--mcp-config", file);
        requires.push("--mcp-config");
      }

      if (context.transport === "stdin") {
        args.push("--stdin");
        requires.push("--stdin");
      }

      return {
        args,
        tail: context.transport === "argv" ? [context.prompt] : [],
        stdin: context.transport === "stdin" ? context.prompt : undefined,
        env: context.home !== undefined ? { FAKE_HOME: context.home } : undefined,
        files,
        requires,
      };
    },
    parser: () => jsonLinesParser(parseFake),
  };
}
