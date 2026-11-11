import { afterEach, describe, expect, it, vi } from "vitest";
import { cli } from "./cli";
import { ai } from "@warlock.js/ai";
import { renderPrompt, toUsage } from "./model/cli-model";
import { helpLists, missingFlags, parseVersion } from "./probe/probe";
import { addUsage, ResultAggregator } from "./session/aggregate";
import {
  buildEnvironment,
  resetInheritedEnvironmentWarning,
  warnInheritedEnvironment,
} from "./session/environment";
import { EventLog } from "./stream/event-log";
import { jsonLinesParser } from "./stream/json-lines";
import { createLineSplitter, MAX_LINE_BYTES } from "./stream/line-splitter";
import { toToml } from "./utils/toml";

describe("capability probe helpers", () => {
  const help = [
    "Usage: claude [options] [prompt]",
    "  -p, --print                 Print response and exit",
    "  --output-format <format>    Output format",
    "  --resume [sessionId]        Resume",
    "  --mcp-config <configs...>   Load MCP servers",
    "Commands:",
    "  exec    Run non-interactively",
  ].join("\n");

  it("matches whole flags and subcommand words only", () => {
    expect(helpLists(help, "-p")).toBe(true);
    expect(helpLists(help, "--print")).toBe(true);
    expect(helpLists(help, "--output-format")).toBe(true);
    expect(helpLists(help, "--output")).toBe(false);
    expect(helpLists(help, "--resume")).toBe(true);
    expect(helpLists(help, "--mcp")).toBe(false);
    expect(helpLists(help, "exec")).toBe(true);
    expect(helpLists(help, "exe")).toBe(false);
    expect(missingFlags(help, ["--print", "--json"])).toEqual(["--json"]);
  });

  it("extracts the version", () => {
    expect(parseVersion("2.1.302 (Claude Code)")).toBe("2.1.302");
    expect(parseVersion("codex-cli 0.163.0")).toBe("0.163.0");
    expect(parseVersion("2026.10.16-e3cb207")).toBe("2026.10.16-e3cb207");
    expect(parseVersion("reasonix v2.43.0\n")).toBe("2.43.0");
    expect(parseVersion("")).toBe("unknown");
  });
});

describe("stream plumbing", () => {
  it("splits lines across chunks, CRLF and split UTF-8 characters", () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    const text = Buffer.from('{"a":"é"}\r\n{"b":1}\nlast');

    splitter.write(text.subarray(0, 7));
    splitter.write(text.subarray(7, 13));
    splitter.write(text.subarray(13));
    splitter.end();

    expect(lines).toEqual(['{"a":"é"}', '{"b":1}', "last"]);
  });

  it("keeps a very long line delivered in many chunks whole", () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    const body = "x".repeat(16 * 1024 * 1024);
    const text = Buffer.from(`{"a":"${body}"}\r\n{"b":1}\n`);
    const chunk = 64 * 1024;

    for (let offset = 0; offset < text.length; offset += chunk) {
      splitter.write(text.subarray(offset, offset + chunk));
    }

    splitter.end();

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`{"a":"${body}"}`);
    expect(lines[1]).toBe('{"b":1}');
  });

  it("joins a CRLF split across chunks and emits several lines from one chunk", () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));

    splitter.write(Buffer.from("one\r"));
    splitter.write(Buffer.from("\ntwo\nthree\nfo"));
    splitter.write(Buffer.from("ur"));
    splitter.end();

    expect(lines).toEqual(["one", "two", "three", "four"]);
  });

  it("drops a line past the cap, reports it once and resumes on the next line", () => {
    const lines: string[] = [];
    const onOverflow = vi.fn();
    const splitter = createLineSplitter((line) => lines.push(line), onOverflow);
    const chunk = Buffer.alloc(4 * 1024 * 1024, "y");
    const chunks = Math.ceil(MAX_LINE_BYTES / chunk.length) + 2;

    splitter.write(Buffer.from("before\n"));

    for (let index = 0; index < chunks; index++) {
      splitter.write(chunk);
    }

    splitter.write(Buffer.from("tail-of-long-line\nafter\n"));
    splitter.end();

    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["before", "after"]);
  });

  it("skips non-JSON lines in a JSONL parser", () => {
    const parser = jsonLinesParser((record) => [
      { type: "message", text: String(record.t), delta: false },
    ]);

    expect(parser.line("Loading…")).toEqual([]);
    expect(parser.line("{broken")).toEqual([]);
    expect(parser.line('{"t":"ok"}')).toEqual([{ type: "message", text: "ok", delta: false }]);
  });

  it("replays the event log to late consumers", async () => {
    const log = new EventLog<number>();
    const early: number[] = [];
    const reading = (async () => {
      for await (const item of log) early.push(item);
    })();

    log.push(1);
    log.push(2);
    log.close();
    await reading;

    const late: number[] = [];

    for await (const item of log) late.push(item);

    expect(early).toEqual([1, 2]);
    expect(late).toEqual([1, 2]);
  });
});

describe("result aggregation", () => {
  it("prefers the vendor's final record, then the newest message", () => {
    const withFinal = new ResultAggregator();

    withFinal.add({ type: "message", text: "Looking…", delta: false });
    withFinal.add({ type: "message", text: "Answer", delta: false, final: true });
    expect(withFinal.text).toBe("Answer");

    const deltasOnly = new ResultAggregator();

    deltasOnly.add({ type: "message", text: "Let me ", delta: true });
    deltasOnly.add({ type: "message", text: "look", delta: true });
    deltasOnly.add({ type: "tool.call", id: "1", name: "ls", input: {} });
    deltasOnly.add({ type: "message", text: "Done", delta: true });
    deltasOnly.finish();
    expect(deltasOnly.text).toBe("Done");
    expect(deltasOnly.messages).toEqual(["Let me look", "Done"]);
  });

  it("adds turn usage and replaces with cumulative totals", () => {
    const aggregator = new ResultAggregator("prev");

    aggregator.add({
      type: "usage",
      cumulative: false,
      usage: { input: 10, output: 2, total: 12, costUSD: 0.1 },
    });
    aggregator.add({
      type: "usage",
      cumulative: false,
      usage: { input: 5, output: 1, total: 6, cachedTokens: 3 },
    });
    expect(aggregator.usage).toEqual({
      input: 15,
      output: 3,
      total: 18,
      cachedTokens: 3,
      costUSD: 0.1,
    });

    aggregator.add({ type: "usage", cumulative: true, usage: { input: 20, output: 4, total: 24 } });
    expect(aggregator.usage).toEqual({ input: 20, output: 4, total: 24 });
    expect(aggregator.sessionRef).toBe("prev");
    expect(addUsage(undefined, { input: 1, output: 1, total: 2 })).toEqual({
      input: 1,
      output: 1,
      total: 2,
    });
  });
});

describe("environment", () => {
  const source = {
    PATH: "/usr/bin",
    HOME: "/home/dev",
    CLAUDE_CONFIG_DIR: "/home/dev/.claude",
    OPENAI_API_KEY: "sk-other",
  };

  it("strips managed home variables and applies plan, key and caller env in order", () => {
    expect(
      buildEnvironment({
        source,
        inherit: true,
        managed: ["CLAUDE_CONFIG_DIR"],
        plan: { CLAUDE_CONFIG_DIR: "/tmp/run/home", MODE: "plan" },
        apiKey: { name: "ANTHROPIC_API_KEY", value: "sk-ant" },
        user: { MODE: "user" },
        platform: "linux",
      }),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
      OPENAI_API_KEY: "sk-other",
      CLAUDE_CONFIG_DIR: "/tmp/run/home",
      MODE: "user",
      ANTHROPIC_API_KEY: "sk-ant",
    });
  });

  it("passes only the minimal set (plus listed names) when inheritance is off", () => {
    expect(buildEnvironment({ source, inherit: false, managed: [], platform: "linux" })).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/dev",
    });
    expect(
      buildEnvironment({ source, inherit: ["OPENAI_API_KEY"], managed: [], platform: "linux" }),
    ).toMatchObject({ OPENAI_API_KEY: "sk-other" });
  });

  it("passes the minimal set plus the adapter's credential variables with inheritance curated", () => {
    expect(
      buildEnvironment({
        source: { ...source, ANTHROPIC_API_KEY: "sk-ant", DATABASE_URL: "postgres://secret" },
        inherit: "curated",
        credentials: ["ANTHROPIC_API_KEY"],
        managed: ["CLAUDE_CONFIG_DIR"],
        platform: "linux",
      }),
    ).toEqual({ PATH: "/usr/bin", HOME: "/home/dev", ANTHROPIC_API_KEY: "sk-ant" });
  });

  it("treats Windows names case-insensitively", () => {
    expect(
      buildEnvironment({
        source: { Path: "C:\\bin" },
        inherit: false,
        managed: [],
        plan: { PATH: "D:\\bin" },
        platform: "win32",
      }),
    ).toEqual({ PATH: "D:\\bin" });
  });
});

describe("inheritEnv production warning", () => {
  afterEach(() => {
    resetInheritedEnvironmentWarning();
    vi.restoreAllMocks();
  });

  it("warns once in production when inheritEnv is left at its default", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnInheritedEnvironment("Claude Code", undefined, { NODE_ENV: "production" });
    warnInheritedEnvironment("Claude Code", undefined, { NODE_ENV: "production" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("inheritEnv");
  });

  it("stays silent outside production or when inheritEnv is set explicitly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    warnInheritedEnvironment("Claude Code", undefined, { NODE_ENV: "development" });
    warnInheritedEnvironment("Claude Code", true, { NODE_ENV: "production" });
    warnInheritedEnvironment("Claude Code", "curated", { NODE_ENV: "production" });

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("TOML writer", () => {
  it("writes nested tables, arrays and quoted keys", () => {
    expect(
      toToml({
        mcp_servers: {
          docs: { command: "npx", args: ["-y", "docs-mcp"], env: { TOKEN: 'a"b' } },
          "my server": { url: "https://x" },
        },
        plugins: [{ name: "p", enabled: true }],
      }),
    ).toBe(
      [
        'plugins = [{ name = "p", enabled = true }]',
        "",
        "[mcp_servers.docs]",
        'command = "npx"',
        'args = ["-y", "docs-mcp"]',
        "",
        "[mcp_servers.docs.env]",
        'TOKEN = "a\\"b"',
        "",
        '[mcp_servers."my server"]',
        'url = "https://x"',
        "",
      ].join("\n"),
    );
  });
});

describe("model adapter", () => {
  it("renders a single user turn as-is and a history as a transcript", () => {
    expect(
      renderPrompt(
        [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
        "codex",
      ),
    ).toBe("Be brief.\n\nHi");
    expect(
      renderPrompt(
        [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
          { role: "user", content: [{ type: "text", text: "Again" }] },
        ],
        "codex",
      ),
    ).toBe("User:\nHi\n\nAssistant:\nHello\n\nUser:\nAgain");
  });

  it("refuses non-text attachments", () => {
    expect(() =>
      renderPrompt(
        [{ role: "user", content: [{ type: "image", source: { url: "https://x/a.png" } }] }],
        "codex",
      ),
    ).toThrow(/text only/);
  });

  it("maps usage", () => {
    expect(toUsage(undefined)).toEqual({ input: 0, output: 0, total: 0 });
    expect(toUsage({ input: 3, output: 1, total: 4, cachedTokens: 2, costUSD: 1 })).toEqual({
      input: 3,
      output: 1,
      total: 4,
      cachedTokens: 2,
    });
  });
});

describe("namespace", () => {
  it("registers ai.cli with a factory per vendor", () => {
    expect(ai.cli).toBe(cli);

    const codex = cli.codex({ model: "gpt-5.5" });

    expect(codex.adapter.name).toBe("codex");
    expect(codex.options.model).toBe("gpt-5.5");
    expect(cli.custom(cli.adapters.aider).adapter.name).toBe("aider");
    expect(codex.model({ name: "coder" }).name).toBe("coder");
    expect(codex.model().provider).toBe("codex");
  });
});
