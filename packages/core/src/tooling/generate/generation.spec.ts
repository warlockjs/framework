import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGeneration, sandboxBackend } from "./generation";
import type { CliInvocation, CliRun, CliRunner } from "./run-cli";

let project: string;
let temp: string;

function write(root: string, file: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  writeFileSync(path.join(root, file), content);
}

const ok: CliRun = { exitCode: 0, signal: null, stdout: "done", stderr: "", timedOut: false };

/** A runner that edits files inside the cwd it is given, like a generator would. */
function fakeRunner(
  edit: (cwd: string) => void,
  seen: CliInvocation[] = [],
  result: CliRun = ok,
): CliRunner {
  return async (invocation) => {
    seen.push(invocation);
    edit(invocation.cwd);
    return result;
  };
}

beforeEach(() => {
  project = mkdtempSync(path.join(os.tmpdir(), "warlock-generate-project-"));
  temp = mkdtempSync(path.join(os.tmpdir(), "warlock-generate-sandboxes-"));
  write(project, "package.json", '{\n  "name": "fixture"\n}\n');
  write(project, ".env", "DB_PASSWORD=secret\n");
  write(project, ".env.local", "TOKEN=secret\n");
  write(project, "src/app/users/routes.ts", 'import { router } from "@warlock.js/core";\n');
  write(project, "node_modules/some-package/index.js", "export {};\n");
  write(project, "storage/big.log", "not copied\n");
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(temp, { recursive: true, force: true });
});

describe("sandboxBackend", () => {
  it("reports created, modified and deleted files as diffs without touching the project", async () => {
    const seen: CliInvocation[] = [];
    const runner = fakeRunner((cwd) => {
      write(
        cwd,
        "src/app/users/services/send-welcome.service.ts",
        "export function sendWelcome() {}\n",
      );
      write(
        cwd,
        "src/app/users/routes.ts",
        'import { router } from "@warlock.js/core";\nrouter.get("/x", h);\n',
      );
      write(cwd, "package.json", '{\n  "name": "fixture",\n  "private": true\n}\n');
    }, seen);

    const plan = await sandboxBackend({
      runner,
      cliEntry: "/bin/warlock.js",
      tempDirectory: temp,
    }).plan({ type: "make", generator: "service", name: "users/send-welcome" }, { cwd: project });

    expect(plan.ok).toBe(true);
    expect(plan.command).toEqual(["warlock", "generate.service", "users/send-welcome"]);
    expect(seen[0]?.entry).toBe("/bin/warlock.js");
    expect(seen[0]?.cwd).not.toBe(project);
    expect(plan.files.map((file) => [file.status, file.path])).toEqual([
      ["modified", "package.json"],
      ["modified", "src/app/users/routes.ts"],
      ["created", "src/app/users/services/send-welcome.service.ts"],
    ]);
    expect(plan.files[1]?.diff).toContain('+router.get("/x", h);');
    expect(plan.files[2]?.diff).toContain("--- /dev/null");
    // The project itself is unchanged.
    expect(existsSync(path.join(project, "src/app/users/services"))).toBe(false);
    expect(readFileSync(path.join(project, "package.json"), "utf8")).toBe(
      '{\n  "name": "fixture"\n}\n',
    );
  });

  it("copies root files and src/, links node_modules, and never copies env files or other folders", async () => {
    let listing: string[] = [];
    let linked = false;
    const runner = fakeRunner((cwd) => {
      listing = readdirSync(cwd).sort();
      linked = existsSync(path.join(cwd, "node_modules/some-package/index.js"));
    });

    await sandboxBackend({ runner, tempDirectory: temp }).plan(
      { type: "add", features: ["devtools"] },
      { cwd: project },
    );

    expect(listing).toEqual(["node_modules", "package.json", "src"]);
    expect(linked).toBe(true);
  });

  it("runs add with --no-install", async () => {
    const seen: CliInvocation[] = [];

    await sandboxBackend({ runner: fakeRunner(() => undefined, seen), tempDirectory: temp }).plan(
      { type: "add", features: ["devtools"] },
      { cwd: project },
    );

    expect(seen[0]?.args).toEqual(["add", "devtools", "--no-install"]);
  });

  it("removes the sandbox afterwards, even when the runner throws, and leaves node_modules alone", async () => {
    const failing: CliRunner = async () => {
      throw new Error("boom");
    };

    await expect(
      sandboxBackend({ runner: failing, tempDirectory: temp }).plan(
        { type: "make", generator: "module", name: "posts" },
        { cwd: project },
      ),
    ).rejects.toThrow("boom");
    await sandboxBackend({ runner: fakeRunner(() => undefined), tempDirectory: temp }).plan(
      { type: "make", generator: "module", name: "posts" },
      { cwd: project },
    );

    expect(readdirSync(temp)).toEqual([]);
    expect(existsSync(path.join(project, "node_modules/some-package/index.js"))).toBe(true);
  });

  it("reports a failed command with its output and no ok", async () => {
    const failed: CliRun = {
      exitCode: 1,
      signal: null,
      stdout: '\u001b[31mError: Module "posts" does not exist\u001b[39m',
      stderr: "",
      timedOut: false,
    };
    const plan = await sandboxBackend({
      runner: fakeRunner(() => undefined, [], failed),
      tempDirectory: temp,
    }).plan({ type: "make", generator: "service", name: "posts/x" }, { cwd: project });

    expect(plan.ok).toBe(false);
    expect(plan.exitCode).toBe(1);
    expect(plan.files).toEqual([]);
    expect(plan.output).toBe('Error: Module "posts" does not exist');
  });

  it("never reports env files, even when the generator writes one", async () => {
    const plan = await sandboxBackend({
      runner: fakeRunner((cwd) => write(cwd, ".env", "NEW=1\n")),
      tempDirectory: temp,
    }).plan({ type: "add", features: ["mail"] }, { cwd: project });

    expect(plan.files).toEqual([]);
  });
});

describe("applyGeneration", () => {
  it("runs in the project and diffs what changed", async () => {
    const seen: CliInvocation[] = [];
    const plan = await applyGeneration(
      { type: "make", generator: "service", name: "users/send-welcome" },
      {
        cwd: project,
        cliEntry: "/bin/warlock.js",
        runner: fakeRunner((cwd) => {
          write(cwd, "src/app/users/services/send-welcome.service.ts", "export {};\n");
          rmSync(path.join(cwd, "src/app/users/routes.ts"));
        }, seen),
      },
    );

    expect(seen[0]?.cwd).toBe(path.resolve(project));
    expect(plan.files.map((file) => [file.status, file.path])).toEqual([
      ["deleted", "src/app/users/routes.ts"],
      ["created", "src/app/users/services/send-welcome.service.ts"],
    ]);
    expect(plan.files[0]?.diff).toContain('-import { router } from "@warlock.js/core";');
    expect(existsSync(path.join(project, "src/app/users/services/send-welcome.service.ts"))).toBe(
      true,
    );
  });

  it("installs add features unless install is false", async () => {
    const seen: CliInvocation[] = [];

    await applyGeneration(
      { type: "add", features: ["devtools"] },
      { cwd: project, runner: fakeRunner(() => undefined, seen) },
    );
    await applyGeneration(
      { type: "add", features: ["devtools"] },
      { cwd: project, install: false, runner: fakeRunner(() => undefined, seen) },
    );

    expect(seen.map((invocation) => invocation.args)).toEqual([
      ["add", "devtools"],
      ["add", "devtools", "--no-install"],
    ]);
  });
});

describe("sandboxBackend with the real CLI", () => {
  it("previews `warlock generate.service` in a fixture app without writing it", async () => {
    rmSync(path.join(project, "node_modules"), { recursive: true, force: true });
    write(
      project,
      "tsconfig.json",
      '{ "compilerOptions": { "target": "ES2022", "module": "ESNext" } }\n',
    );

    // The default entry is this checkout's own bin/warlock.js, run from source.
    const plan = await sandboxBackend({ tempDirectory: temp }).plan(
      { type: "make", generator: "service", name: "users/send-welcome" },
      { cwd: project, timeoutMs: 60_000 },
    );

    expect(plan.output).toContain("send-welcome.service.ts");
    expect(plan.ok).toBe(true);
    expect(plan.files.map((file) => [file.status, file.path])).toEqual([
      ["created", "src/app/users/services/send-welcome.service.ts"],
    ]);
    expect(plan.files[0]?.diff).toMatch(/^\+.*sendWelcome/m);
    expect(existsSync(path.join(project, "src/app/users/services"))).toBe(false);
    expect(readdirSync(temp)).toEqual([]);
  }, 90_000);
});
