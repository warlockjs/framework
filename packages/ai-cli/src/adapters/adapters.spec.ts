import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CliAdapter, CliLaunchContext, CliParsedEvent } from "../contracts";
import { missingFlags } from "../probe/probe";
import { ResultAggregator } from "../session/aggregate";
import { cliAdapters } from "../cli";
import { parseAiderCount } from "./aider";
import { mapEffort } from "./shared";

const fixtures = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fixtures");

function fixture(vendor: string, file: string): string {
  return readFileSync(path.join(fixtures, vendor, file), "utf8");
}

function context(overrides: Partial<CliLaunchContext> = {}): CliLaunchContext {
  return {
    prompt: "List the files",
    transport: "argv",
    cwd: "/work/project",
    permission: "standard",
    home: "/run/x/home",
    homeIsPrivate: true,
    runDir: "/run/x",
    platform: "linux",
    ...overrides,
  };
}

function parse(adapter: CliAdapter, text: string, launch: CliLaunchContext = context()) {
  const parser = adapter.parser(launch);
  const events: CliParsedEvent[] = [];

  for (const line of text.split(/\r?\n/)) {
    events.push(...parser.line(line));
  }

  events.push(...parser.end());

  const aggregator = new ResultAggregator();

  for (const event of events) {
    aggregator.add(event);
  }

  aggregator.finish();

  const lateRef = parser.sessionRef?.();

  return {
    events,
    types: events.map((event) => event.type),
    text: aggregator.text,
    usage: aggregator.usage,
    sessionRef: lateRef ?? aggregator.sessionRef,
    fatal: aggregator.fatalError,
    tools: events.filter((event) => event.type === "tool.call").map((event) => event.name),
    results: events.filter((event) => event.type === "tool.result"),
  };
}

type StreamCase = {
  vendor: string;
  adapter: CliAdapter;
  file?: string;
  sessionRef?: string;
  text: string;
  tool: string;
  output: string;
  usage?: Record<string, unknown>;
};

const streamCases: StreamCase[] = [
  {
    vendor: "claude-code",
    adapter: cliAdapters.claudeCode,
    sessionRef: "8f3c2a51-6b0e-4c1d-9a7f-2e5d4b3c1a90",
    text: "The directory has README.md, package.json and src.",
    tool: "Bash",
    output: "README.md",
    usage: { input: 18500, output: 54, cachedTokens: 17240, costUSD: 0.0213 },
  },
  {
    vendor: "codex",
    adapter: cliAdapters.codex,
    sessionRef: "019a2f3e-7c41-7b20-9d1e-5f6a7b8c9d0e",
    text: "The directory has README.md, package.json and src.",
    tool: "shell",
    output: "package.json",
    usage: { input: 24763, output: 122, cachedTokens: 24448, reasoningTokens: 64 },
  },
  {
    vendor: "copilot",
    adapter: cliAdapters.copilot,
    sessionRef: "0cb916db-26aa-40f2-86b5-1ba81b225fd2",
    text: "The directory has README.md, package.json and src.",
    tool: "bash",
    output: "README.md",
  },
  {
    vendor: "amp",
    adapter: cliAdapters.amp,
    sessionRef: "T-d2fc4acc-dd1d-497f-9609-ed0da22a7c95",
    text: "The directory has README.md, package.json and src.",
    tool: "Bash",
    output: "README.md",
    usage: { input: 26450, output: 124, cachedTokens: 13150, cacheWriteTokens: 13283 },
  },
  {
    vendor: "qwen-code",
    adapter: cliAdapters.qwenCode,
    sessionRef: "5b0c1f3e-8a7d-4c2e-9f10-2d3c4b5a6e7f",
    text: 'The README contains a single heading: "Demo".',
    tool: "read_file",
    output: "# Demo",
    usage: { input: 20570, output: 60, total: 20630, cachedTokens: 10240 },
  },
  {
    vendor: "antigravity",
    adapter: cliAdapters.antigravity,
    sessionRef: "edb1c8c1-50ba-4f3f-87eb-412d0e9d47c3",
    text: "The project contains README.md and a src directory.\n",
    tool: "run_command",
    output: "README.md",
    usage: { input: 20838, output: 70, total: 20908, cachedTokens: 18353, reasoningTokens: 21 },
  },
  {
    vendor: "cursor",
    adapter: cliAdapters.cursor,
    sessionRef: "c6b62c6f-7ead-4fd6-9922-e952131177ff",
    text: 'The README contains a single heading: "Demo".',
    tool: "read",
    output: "# Demo",
    usage: { input: 10540, output: 64, cachedTokens: 9216, cacheWriteTokens: 512 },
  },
  {
    vendor: "opencode",
    adapter: cliAdapters.opencode,
    sessionRef: "ses_6c1f2a3b4ffeA1b2C3d4E5f6G7",
    text: 'The README contains a single heading: "Demo".',
    tool: "read",
    output: "# Demo",
    usage: {
      input: 30960,
      output: 220,
      cachedTokens: 10240,
      cacheWriteTokens: 60,
      costUSD: expect.closeTo(0.0073, 6),
    },
  },
  {
    vendor: "kimi",
    adapter: cliAdapters.kimi,
    sessionRef: "session_c125a413-a013-4d01-a343-42e291ce3c56",
    text: "The directory contains note.txt.",
    tool: "Bash",
    output: "note.txt",
  },
  {
    vendor: "grok",
    adapter: cliAdapters.grok,
    sessionRef: "3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b13",
    text: "Here's a summary: src/main.rs is a 42-line entry point.",
    tool: "read_file",
    output: "42",
    usage: { input: 1832, output: 75, total: 1907, cachedTokens: 900, costUSD: 0.0021 },
  },
  {
    vendor: "reasonix",
    adapter: cliAdapters.reasonix,
    sessionRef: "20261017-191238.312484202-fake-model",
    text: "The directory contains note.txt.",
    tool: "ls",
    output: "note.txt",
    usage: { input: 220, output: 18, total: 238 },
  },
  {
    vendor: "droid",
    adapter: cliAdapters.droid,
    sessionRef: "8af22e0a-d222-42c6-8c7e-7a059e391b0b",
    text: "This is a small TypeScript project: README.md, package.json, tsconfig.json and a src/ folder.",
    tool: "LS",
    output: "tsconfig.json",
    usage: {
      input: 10597,
      output: 118,
      cachedTokens: 4096,
      cacheWriteTokens: 1180,
      reasoningTokens: 64,
    },
  },
  {
    vendor: "mistral-vibe",
    adapter: cliAdapters.mistralVibe,
    sessionRef: "5f0c2e7a-1b3d-4c8e-9a10-2d4b6f8e0c12",
    text: "This is a small TypeScript project: README.md, package.json, tsconfig.json and a src/ folder.",
    tool: "bash",
    output: "README.md",
  },
  {
    vendor: "aider",
    adapter: cliAdapters.aider,
    file: "stream.txt",
    text: "I'll add a `greet` function",
    tool: "edit",
    output: "Applied edit to src/greet.ts",
    usage: { input: 2400, output: 61, costUSD: 0.0081 },
  },
];

describe("recorded vendor streams", () => {
  for (const testCase of streamCases) {
    it(`${testCase.vendor}: normalizes the recorded stream`, () => {
      const parsed = parse(
        testCase.adapter,
        fixture(testCase.vendor, testCase.file ?? "stream.jsonl"),
      );

      expect(parsed.types[0]).toBe("session.started");
      expect(parsed.types.filter((type) => type === "session.started")).toHaveLength(1);
      expect(parsed.fatal).toBeUndefined();
      expect(parsed.sessionRef).toBe(testCase.sessionRef);

      if (testCase.vendor === "aider") {
        expect(parsed.text).toContain(testCase.text);
      } else {
        expect(parsed.text).toBe(testCase.text);
      }

      expect(parsed.tools).toContain(testCase.tool);
      expect(parsed.results.some((result) => result.output.includes(testCase.output))).toBe(true);

      for (const result of parsed.results) {
        expect(
          parsed.events.some((event) => event.type === "tool.call" && event.id === result.id),
        ).toBe(true);
      }

      if (testCase.usage !== undefined) {
        expect(parsed.usage).toMatchObject(testCase.usage);
      }
    });
  }
});

describe("recorded failures", () => {
  const failures: Array<{ vendor: string; adapter: CliAdapter; file: string; message: string }> = [
    { vendor: "claude-code", adapter: cliAdapters.claudeCode, file: "error.jsonl", message: "401" },
    {
      vendor: "codex",
      adapter: cliAdapters.codex,
      file: "error.jsonl",
      message: "401 Unauthorized",
    },
    {
      vendor: "copilot",
      adapter: cliAdapters.copilot,
      file: "error.jsonl",
      message: "No authentication",
    },
    { vendor: "amp", adapter: cliAdapters.amp, file: "error.jsonl", message: "Unable to connect" },
    { vendor: "qwen-code", adapter: cliAdapters.qwenCode, file: "error.jsonl", message: "401" },
    {
      vendor: "antigravity",
      adapter: cliAdapters.antigravity,
      file: "error.jsonl",
      message: "invalid model selection",
    },
    {
      vendor: "opencode",
      adapter: cliAdapters.opencode,
      file: "error.jsonl",
      message: "ProviderAuthError: Missing API key",
    },
    {
      vendor: "grok",
      adapter: cliAdapters.grok,
      file: "error.jsonl",
      message: "Couldn't start session",
    },
    {
      vendor: "reasonix",
      adapter: cliAdapters.reasonix,
      file: "error.jsonl",
      message: "no stored key",
    },
    {
      vendor: "droid",
      adapter: cliAdapters.droid,
      file: "error.jsonl",
      message: "Authentication failed",
    },
    {
      vendor: "aider",
      adapter: cliAdapters.aider,
      file: "error.txt",
      message: "AuthenticationError",
    },
  ];

  for (const failure of failures) {
    it(`${failure.vendor}: reports the recorded failure as fatal`, () => {
      expect(parse(failure.adapter, fixture(failure.vendor, failure.file)).fatal).toContain(
        failure.message,
      );
    });
  }

  it("copilot: marks a denied tool as an error result", () => {
    const parsed = parse(cliAdapters.copilot, fixture("copilot", "error.jsonl"));

    expect(parsed.results[0]).toMatchObject({
      isError: true,
      output: expect.stringContaining("Permission denied"),
    });
  });

  it("codex: marks a failed command as an error result", () => {
    const parsed = parse(cliAdapters.codex, fixture("codex", "error.jsonl"));

    expect(parsed.results[0]).toMatchObject({ isError: true });
  });

  it("antigravity: reports a tool error", () => {
    const parsed = parse(cliAdapters.antigravity, fixture("antigravity", "error.jsonl"));

    expect(parsed.results[0]).toMatchObject({ isError: true });
  });

  it("kimi: retries are non-fatal errors", () => {
    const parsed = parse(cliAdapters.kimi, fixture("kimi", "error.jsonl"));

    expect(parsed.events.some((event) => event.type === "error" && event.fatal !== true)).toBe(
      true,
    );
    expect(parsed.fatal).toBeUndefined();
  });

  it("reasonix: a refused write is an error result", () => {
    const parsed = parse(cliAdapters.reasonix, fixture("reasonix", "denied.jsonl"));

    expect(parsed.results.some((result) => result.isError)).toBe(true);
  });
});

describe("files read when the stream ends", () => {
  it("mistral-vibe: usage, cost and outcome come from export.json", () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "vibe-export-"));

    try {
      const exportDir = path.join(runDir, "vibe-output");

      mkdirSync(exportDir);
      writeFileSync(path.join(exportDir, "export.json"), fixture("mistral-vibe", "export.json"));

      const ok = parse(
        cliAdapters.mistralVibe,
        fixture("mistral-vibe", "stream.jsonl"),
        context({ runDir }),
      );

      expect(ok.usage).toMatchObject({
        input: 5321,
        output: 118,
        total: 5439,
        cachedTokens: 4096,
        costUSD: 0.003355,
      });

      writeFileSync(
        path.join(exportDir, "export.json"),
        fixture("mistral-vibe", "error.export.json"),
      );

      expect(parse(cliAdapters.mistralVibe, "", context({ runDir })).fatal).toContain(
        "Missing MISTRAL_API_KEY",
      );
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("aider: exact usage comes from the analytics log", () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "aider-log-"));

    try {
      writeFileSync(
        path.join(runDir, "aider-analytics.jsonl"),
        fixture("aider", "analytics.jsonl"),
      );

      const parsed = parse(cliAdapters.aider, fixture("aider", "stream.txt"), context({ runDir }));
      const last = parsed.events.filter((event) => event.type === "usage").at(-1);

      expect(last).toMatchObject({ cumulative: true });
      expect(parsed.usage?.input).toBeGreaterThan(0);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });

  it("copilot: tokens come from the usage file", () => {
    const runDir = mkdtempSync(path.join(tmpdir(), "copilot-usage-"));

    try {
      writeFileSync(
        path.join(runDir, "copilot-usage.json"),
        JSON.stringify({
          modelMetrics: {
            "gpt-5.4": {
              usage: {
                inputTokens: 900,
                outputTokens: 40,
                cacheReadTokens: 600,
                cacheWriteTokens: 0,
              },
            },
            "gpt-5.4-mini": {
              usage: {
                inputTokens: 100,
                outputTokens: 10,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              },
            },
          },
        }),
      );

      const parsed = parse(
        cliAdapters.copilot,
        fixture("copilot", "stream.jsonl"),
        context({ runDir }),
      );

      expect(parsed.usage).toEqual({ input: 1000, output: 50, total: 1050, cachedTokens: 600 });
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  });
});

const helpVerified: Array<[string, CliAdapter]> = [
  ["claude-code", cliAdapters.claudeCode],
  ["codex", cliAdapters.codex],
  ["copilot", cliAdapters.copilot],
  ["amp", cliAdapters.amp],
  ["qwen-code", cliAdapters.qwenCode],
  ["opencode", cliAdapters.opencode],
  ["kimi", cliAdapters.kimi],
  ["reasonix", cliAdapters.reasonix],
  ["droid", cliAdapters.droid],
];

/** A context that turns on every option the adapter supports. */
function fullContext(
  adapter: CliAdapter,
  overrides: Partial<CliLaunchContext> = {},
): CliLaunchContext {
  return context({
    model: adapter.name === "amp" ? undefined : "some-model",
    effort: adapter.effort ? "high" : undefined,
    resume: adapter.name === "aider" ? undefined : "session-1",
    permission: "bypass",
    mcp: adapter.mcp
      ? {
          docs: {
            type: "stdio",
            command: "docs-mcp",
            args: ["--stdio"],
            env: { DOCS_TOKEN: "sk-SECRET-1" },
          },
          remote: {
            type: "http",
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "Bearer sk-SECRET-2" },
          },
        }
      : undefined,
    ...overrides,
  });
}

describe("capability probe against recorded --help", () => {
  for (const [vendor, adapter] of helpVerified) {
    it(`${vendor}: every flag the adapter relies on is listed in its recorded help`, () => {
      const help = fixture(vendor, "help.txt");

      for (const transport of adapter.transports) {
        const plan = adapter.plan(fullContext(adapter, { transport }));

        expect(missingFlags(help, plan.requires)).toEqual([]);
      }
    });
  }

  it("a renamed flag is reported missing", () => {
    expect(missingFlags("  --print  print\n", ["--print", "--output-format"])).toEqual([
      "--output-format",
    ]);
  });
});

describe("launch plans", () => {
  const all = Object.values(cliAdapters);

  for (const adapter of all) {
    it(`${adapter.name}: keeps secrets out of argv and uses bypass only when asked`, () => {
      const bypass = adapter.plan(fullContext(adapter));
      const standard = adapter.plan(
        fullContext(adapter, { permission: adapter.name === "kimi" ? "bypass" : "standard" }),
      );
      const argv = [...bypass.args, ...(bypass.tail ?? [])].join(" ");

      expect(argv).not.toContain("sk-SECRET");

      if (adapter.mcp) {
        const written = (bypass.files ?? []).map((file) => file.content).join("\n");
        const env = JSON.stringify(bypass.env ?? {});

        expect(written.includes("sk-SECRET-1") || env.includes("sk-SECRET-1")).toBe(true);
        expect(written.includes("sk-SECRET-2") || env.includes("sk-SECRET-2")).toBe(true);
      }

      const standardArgv = [...standard.args, ...(standard.tail ?? [])];
      const bypassFlags = [
        "--dangerously-skip-permissions",
        "--dangerously-bypass-approvals-and-sandbox",
        "--allow-all",
        "--dangerously-allow-all",
        "--skip-permissions-unsafe",
        "--yolo",
        "--always-approve",
        "--force",
        "--auto",
        "--auto-approve",
      ];

      if (adapter.name !== "kimi") {
        expect(standardArgv.filter((element) => bypassFlags.includes(element))).toEqual([]);
      }
    });

    it(`${adapter.name}: writes files only inside the run directory`, () => {
      for (const file of adapter.plan(fullContext(adapter)).files ?? []) {
        expect(file.path.startsWith("/run/x/")).toBe(true);
      }
    });

    it(`${adapter.name}: puts the prompt where the transport says`, () => {
      for (const transport of adapter.transports) {
        const plan = adapter.plan(
          context({ transport, permission: adapter.name === "kimi" ? "bypass" : "standard" }),
        );
        const argv = [...plan.args, ...(plan.tail ?? [])];

        if (transport === "argv") {
          expect(argv).toContain("List the files");
        } else if (transport === "stdin") {
          expect(argv).not.toContain("List the files");
          expect(plan.stdin).toContain("List the files");
        } else {
          expect(argv).not.toContain("List the files");
          expect(plan.files?.some((file) => file.content === "List the files")).toBe(true);
        }
      }
    });
  }

  it("guards a prompt that starts with a dash", () => {
    const plan = cliAdapters.claudeCode.plan(context({ prompt: "--help me" }));

    expect(plan.tail).toEqual([" --help me"]);
  });

  it("refuses MCP that would be written into a shared home", () => {
    expect(() =>
      cliAdapters.kimi.plan(
        fullContext(cliAdapters.kimi, { homeIsPrivate: false, home: "/srv/kimi-home" }),
      ),
    ).toThrow(/home/);
  });

  it("codex: passes MCP as -c overrides with secrets in the environment for a shared home", () => {
    const plan = cliAdapters.codex.plan(
      fullContext(cliAdapters.codex, { homeIsPrivate: false, home: "/srv/codex" }),
    );
    const argv = plan.args.join(" ");

    expect(argv).toContain('mcp_servers.docs.command="docs-mcp"');
    expect(argv).toContain('mcp_servers.docs.env_vars=["DOCS_TOKEN"]');
    expect(argv).not.toContain("sk-SECRET");
    expect(plan.env?.DOCS_TOKEN).toBe("sk-SECRET-1");
    expect(plan.files ?? []).toEqual([]);
  });

  it("codex: resume uses the exec resume subcommand", () => {
    const plan = cliAdapters.codex.plan(context({ resume: "thread-9" }));

    expect(plan.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(plan.tail).toEqual(["thread-9", "List the files"]);
  });

  it("kimi: refuses the standard permission it cannot enforce", () => {
    expect(() => cliAdapters.kimi.plan(context())).toThrow(/bypass/);
  });

  it("reasonix: writes the API key to its private .env, never argv", () => {
    const plan = cliAdapters.reasonix.plan(context({ apiKey: "sk-deepseek" }));

    expect(plan.files?.find((file) => file.path.endsWith(".env"))?.content).toBe(
      "DEEPSEEK_API_KEY=sk-deepseek\n",
    );
    expect(plan.args.join(" ")).not.toContain("sk-deepseek");
  });
});

describe("helpers", () => {
  it("maps effort to the nearest vendor level", () => {
    const levels = { low: "low", medium: "medium", high: "high" };

    expect(mapEffort("high", levels)).toBe("high");
    expect(mapEffort("minimal", levels)).toBe("low");
    expect(mapEffort("none", levels)).toBe("low");
    expect(mapEffort("max", levels)).toBe("high");
    expect(mapEffort("medium", { low: "l", high: "h" })).toBe("h");
  });

  it("parses Aider's abbreviated token counts", () => {
    expect(parseAiderCount("61")).toBe(61);
    expect(parseAiderCount("2.4k")).toBe(2400);
    expect(parseAiderCount("12k")).toBe(12000);
    expect(parseAiderCount("1.5M")).toBe(1_500_000);
    expect(parseAiderCount("x")).toBeUndefined();
  });

  it("registers every vendor from the report", () => {
    expect(Object.keys(cliAdapters).sort()).toEqual(
      [
        "aider",
        "amp",
        "antigravity",
        "claudeCode",
        "codex",
        "copilot",
        "cursor",
        "droid",
        "grok",
        "kimi",
        "mistralVibe",
        "opencode",
        "qwenCode",
        "reasonix",
      ].sort(),
    );

    for (const adapter of Object.values(cliAdapters)) {
      expect(adapter.verification.sources.length).toBeGreaterThan(0);
      expect(["help", "docs"]).toContain(adapter.verification.verifiedBy);
    }
  });
});
