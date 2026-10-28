import * as childProcess from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueCommand } from "../../../src/cli/commands/issue.command";
import {
  collectIssueConfig,
  collectIssueEnvironment,
  type IssueEnvironment,
} from "../../../src/cli/commands/issue/collect-environment";
import {
  createFrameworkIssueUrl,
  frameworkIssueBody,
  ISSUE_URL_MAX_LENGTH,
} from "../../../src/cli/commands/issue/issue-command.action";
import { frameworkCommands } from "../../../src/cli/framework-cli-commands";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: vi.fn(),
}));

const TEMP_ROOT = path.resolve(__dirname, "../../../../../.tmp");
let fixture: string;

function write(file: string, contents: string): void {
  const target = path.join(fixture, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function install(name: string, version: string): void {
  write(`node_modules/${name}/package.json`, JSON.stringify({ name, version }));
}

function environment(): IssueEnvironment {
  return collectIssueEnvironment(fixture, "pnpm/11.24.0 npm/? node/v22.15.0 linux x64");
}

function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  return lines;
}

beforeEach(() => {
  vi.mocked(childProcess.spawnSync).mockReset();
  mkdirSync(TEMP_ROOT, { recursive: true });
  fixture = mkdtempSync(path.join(TEMP_ROOT, "issue-unit-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(fixture, { recursive: true, force: true });
});

describe("warlock issue environment", () => {
  it("reads actual installed versions including symlinks, not app ranges or names", () => {
    write(
      "package.json",
      JSON.stringify({ name: "private-fixture", dependencies: { "@warlock.js/core": "^1.0.0" } }),
    );
    install("@warlock.js/core", "5.32.0");
    write(
      "linked-package/package.json",
      JSON.stringify({ name: "@warlock.js/web", version: "5.32.0" }),
    );
    symlinkSync(
      path.join(fixture, "linked-package"),
      path.join(fixture, "node_modules/@warlock.js/web"),
      "junction",
    );
    install("typescript", "7.0.2");
    write("node_modules/@warlock.js/broken/package.json", "{broken");
    install("@warlock.js/invalid", "not a version");

    const result = environment();
    expect(result.packages).toMatchObject({
      "@warlock.js/core": "5.32.0",
      "@warlock.js/web": "5.32.0",
    });
    expect(result.packages).not.toHaveProperty("@warlock.js/broken");
    expect(result.packages).not.toHaveProperty("@warlock.js/invalid");
    expect(result.typescript).toBe("7.0.2");
    expect(result.node).toBe(process.version);
    expect(result.packageManager).toEqual({ name: "pnpm", version: "11.24.0" });
    expect(result.os).toEqual({ platform: os.platform(), release: os.release(), arch: os.arch() });
    expect(JSON.stringify(result)).not.toContain("private-fixture");
  });

  it("uses the closest installed version for hoisted packages", () => {
    install("@warlock.js/core", "5.31.0");
    install("typescript", "7.0.2");
    const nested = path.join(fixture, "apps/example");
    mkdirSync(path.join(nested, "node_modules/@warlock.js/core"), { recursive: true });
    writeFileSync(
      path.join(nested, "node_modules/@warlock.js/core/package.json"),
      '{"version":"5.32.0"}',
    );
    const result = collectIssueEnvironment(nested, "npm/10.9.2");
    expect(result.packages["@warlock.js/core"]).toBe("5.32.0");
    expect(result.typescript).toBe("7.0.2");
  });

  it("tolerates an app with no readable manifests or config", () => {
    write("package.json", "{broken");
    write("node_modules/typescript/package.json", "{broken");
    const result = collectIssueEnvironment(fixture, "unknown");
    expect(result.packageManager).toBeNull();
    expect(result.typescript).toBeNull();
    expect(result.config.status).toBe("missing");
    expect(result).not.toHaveProperty("cwd");
  });

  it("probes only a known manager and reports the actual version rather than the declared version", () => {
    write("package.json", '{"packageManager":"pnpm@10.0.0"}');
    const probe = vi.mocked(childProcess.spawnSync).mockReturnValue({
      pid: 123,
      output: [null, "11.24.0\n", ""],
      stdout: "11.24.0\n",
      stderr: "",
      status: 0,
      signal: null,
    });
    expect(collectIssueEnvironment(fixture, "unknown").packageManager).toEqual({
      name: "pnpm",
      version: "11.24.0",
    });
    expect(probe).toHaveBeenCalledWith(
      "pnpm",
      ["--version"],
      expect.objectContaining({ timeout: 3_000, maxBuffer: 4_096 }),
    );
  });

  it("infers a lockfile's manager and handles unavailable tools without leaking stderr", () => {
    write("yarn.lock", "");
    vi.mocked(childProcess.spawnSync).mockReturnValue({
      pid: 124,
      output: [null, "", "private diagnostics"],
      stdout: "",
      stderr: "private diagnostics",
      status: 1,
      signal: null,
    });
    const result = collectIssueEnvironment(fixture, "");
    expect(result.packageManager).toEqual({ name: "yarn", version: null });
    expect(JSON.stringify(result)).not.toContain("private diagnostics");
  });

  it("never executes untrusted packageManager values", () => {
    write("package.json", '{"packageManager":"custom-command@1.0.0"}');
    const probe = vi.mocked(childProcess.spawnSync);
    expect(collectIssueEnvironment(fixture, "").packageManager).toBeNull();
    expect(probe).not.toHaveBeenCalled();
  });

  it("collects only fixed config sections, literal flags and counts without executing code", () => {
    write(
      "warlock.config.ts",
      `
      import missing from "module-that-does-not-exist";
      throw new Error("CONFIG_SENTINEL");
      export default defineConfig({
        build: { minify: false, sourcemap: true, outdir: "PRIVATE_PATH", define: { TOKEN: "SECRET_SENTINEL" } },
        connectors: [missing({ name: "PRIVATE_CONNECTOR" })],
        cli: { commands: [missing] }, database: { password: "SECRET_SENTINEL" },
        PRIVATE_KEY: "SECRET_SENTINEL", server: { host: "PRIVATE_HOST" }
      } satisfies SomeConfig);
    `,
    );
    write(".env", "TOKEN=ENV_SENTINEL");
    const result = collectIssueConfig(fixture);
    expect(result).toEqual({
      status: "static",
      sections: ["server", "build", "connectors", "cli", "database"],
      buildFlags: { minify: false, sourcemap: true },
      connectors: 1,
      customCommands: 1,
      dynamic: false,
    });
    expect(JSON.stringify(environment())).not.toMatch(/SENTINEL|PRIVATE_/);
  });

  it("does not count dynamic arrays or evaluate computed properties", () => {
    write(
      "warlock.config.ts",
      'export default { ...base, [secret]: "hidden", connectors: [...other], cli: { commands: getCommands() }, build: { minify: env("FLAG") } };',
    );
    expect(collectIssueConfig(fixture)).toMatchObject({
      status: "static",
      dynamic: true,
      connectors: null,
      customCommands: null,
      buildFlags: {},
    });
  });

  it("handles unreadable config without exposing filesystem error details", () => {
    mkdirSync(path.join(fixture, "warlock.config.ts"));
    expect(collectIssueConfig(fixture)).toMatchObject({ status: "unreadable", sections: [] });
    expect(JSON.stringify(collectIssueConfig(fixture))).not.toContain(fixture);
  });

  it.each([
    "export default makeConfig();",
    "export default namedConfig;",
    "export default defineConfig({",
  ])("handles unrecognized or invalid config without exposing source: %s", (source) => {
    write("warlock.config.ts", source);
    expect(collectIssueConfig(fixture)).toMatchObject({
      status: "unparsed",
      dynamic: true,
      sections: [],
    });
  });
});

describe("warlock issue URL and command", () => {
  it("registers with typed flags and no preload", () => {
    expect(frameworkCommands).toContain(issueCommand);
    expect(issueCommand.commandPreload).toBeUndefined();
    expect(issueCommand.commandOptions.map((option) => option.name)).toEqual([
      "type",
      "title",
      "json",
    ]);
  });

  it.each(["bug", "feature"] as const)(
    "encodes %s title, template, body and form environment field",
    (type) => {
      const env = environment();
      const title = "Unicode 🧙 & title? # + / =";
      const url = new URL(createFrameworkIssueUrl(type, title, env));
      expect(url.origin + url.pathname).toBe("https://github.com/warlockjs/framework/issues/new");
      expect(url.searchParams.get("title")).toBe(title);
      expect(url.searchParams.get("template")).toBe(`${type}.yml`);
      expect(url.searchParams.get("body")).toBe(frameworkIssueBody(type, env));
      expect(url.searchParams.get("environment")).toBe(JSON.stringify(env, null, 2));
      expect(url.searchParams.get("body")).toContain(
        type === "bug" ? "Expected behavior" : "Alternatives considered",
      );
    },
  );

  it("caps the complete encoded URL, including long Unicode titles, and notes truncation", () => {
    const env = environment();
    for (let index = 0; index < 1_000; index++)
      env.packages[`@warlock.js/package-${index}`] = "5.32.0";
    const url = createFrameworkIssueUrl("bug", "🧙".repeat(2_000), env);
    const parsed = new URL(url);
    expect(url.length).toBeLessThanOrEqual(ISSUE_URL_MAX_LENGTH);
    expect(parsed.searchParams.get("title")).toBe("🧙".repeat(256));
    expect(parsed.searchParams.get("body")).toContain("Truncated for URL length");
    expect(parsed.searchParams.get("environment")).toContain("Truncated for URL length");
    expect(decodeURIComponent(url)).not.toContain("\uFFFD");
    expect(Object.keys(env.packages).length).toBeGreaterThanOrEqual(1_000);
  });

  it("prints exactly the versioned JSON shape", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(fixture);
    vi.stubEnv("npm_config_user_agent", "pnpm/11.24.0");
    const lines = capture();
    await issueCommand.execute({
      args: [],
      options: { json: true, type: "feature", title: "Public capability" },
    });
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines.join("\n"));
    expect(Object.keys(report)).toEqual(["schemaVersion", "environment", "url"]);
    expect(report.schemaVersion).toBe(1);
    expect(report.environment).toEqual(environment());
    expect(new URL(report.url).searchParams.get("template")).toBe("feature.yml");
  });

  it("prints the full environment and a review reminder in text mode", async () => {
    vi.spyOn(process, "cwd").mockReturnValue(fixture);
    const lines = capture();
    await issueCommand.execute({ args: [], options: {} });
    expect(lines.join("\n")).toContain("ask the user before filing");
    expect(lines.join("\n")).toContain('"node"');
    expect(new URL(lines.at(-1) ?? "").searchParams.get("template")).toBe("bug.yml");
  });

  it("rejects invalid issue types before collecting or printing", async () => {
    const lines = capture();
    await expect(issueCommand.execute({ args: [], options: { type: "invalid" } })).rejects.toThrow(
      "--type must be bug or feature",
    );
    expect(lines).toEqual([]);
  });
});
