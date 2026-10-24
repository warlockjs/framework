import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runReleaseAction } from "../cli/commands/release/release-command.action";
import { activateRelease, rollbackRelease } from "./activate";
import { createCandidate } from "./candidate";
import { resolveReleaseConfig } from "./config";
import { runGate } from "./gate";
import { proveMigrations, type MigrationProofProvider } from "./migrations-proof";
import { pruneReleases } from "./prune";
import { listReleases } from "./report";
import { shellRunner } from "./runner";
import { compareVersions } from "./semver";
import { stageRelease } from "./stage";
import { readManifest, readLog, readPointer, type ReleaseContext } from "./store";
import type { CommandRunner, ReleaseConfig } from "./types";
import { verifyRelease } from "./verify";

let root: string;
let ran: Array<{ command: string; cwd: string; env?: NodeJS.ProcessEnv }>;
let failing: Set<string>;
let tick: number;

/** Real git and tar (local, temp dir); everything else is recorded, not run. */
const runner: CommandRunner = async (command, options) => {
  if (command.startsWith("git ") || command.startsWith("tar ")) {
    return shellRunner(command, options);
  }

  ran.push({ command, cwd: options.cwd, env: options.env });

  if (command === "build") {
    await mkdir(path.join(options.cwd, "dist"), { recursive: true });
    await writeFile(path.join(options.cwd, "dist", "app.js"), "console.log('app');\n");
  }

  return failing.has(command)
    ? { code: 1, output: `${command} exploded` }
    : { code: 0, output: "" };
};

function git(...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd: root, encoding: "utf8" },
  ).trim();
}

async function commitVersion(version: string): Promise<string> {
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "app", version }));
  git("add", "-A");
  git("commit", "-m", `v${version}`);

  return git("rev-parse", "HEAD");
}

function makeContext(config: ReleaseConfig = {}): ReleaseContext {
  return {
    root,
    config: resolveReleaseConfig({
      gate: {
        checks: [
          { name: "lint", command: "lint" },
          { name: "test", command: "test" },
          { name: "build", command: "build" },
        ],
      },
      ...config,
    }),
    runner,
    // Every call is a second later, so releases order by creation.
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)),
    nodeVersion: "v22.15.0",
  };
}

/** candidate -> gate -> stage for the current HEAD */
async function prepare(context: ReleaseContext): Promise<string> {
  const candidate = await createCandidate(context);

  await runGate(context, candidate.id);
  await stageRelease(context, candidate.id);

  return candidate.id;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "warlock-release-"));
  ran = [];
  failing = new Set();
  tick = 0;
  git("init", "-q");
  await writeFile(path.join(root, ".gitignore"), ".warlock\nnode_modules\n");
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("compareVersions", () => {
  it("orders numerically, not as text", () => {
    expect(compareVersions("1.10.0", "1.2.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("v2.0.0", "10.0.0")).toBeLessThan(0);
  });

  it("ranks a prerelease below its release and ignores build metadata", () => {
    expect(compareVersions("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0+build5", "1.0.0")).toBe(0);
  });

  it("rejects text that is not a version", () => {
    expect(() => compareVersions("latest", "1.0.0")).toThrow(/not a valid semantic version/);
  });
});

describe("resolveReleaseConfig", () => {
  it("defaults to the typecheck, check, test and build gate", () => {
    const config = resolveReleaseConfig();

    expect(config.checks.map((check) => check.name)).toEqual([
      "typecheck",
      "check",
      "test",
      "build",
    ]);
    expect(config.directory).toBe(".warlock");
    expect(config.restart.command).toBeUndefined();
  });

  it("rejects duplicate check names", () => {
    expect(() =>
      resolveReleaseConfig({
        gate: {
          checks: [
            { name: "a", command: "x" },
            { name: "a", command: "y" },
          ],
        },
      }),
    ).toThrow(/two checks named "a"/);
  });
});

describe("createCandidate", () => {
  it("freezes the commit with a manifest", async () => {
    const commit = await commitVersion("1.0.0");
    const manifest = await createCandidate(makeContext());

    expect(manifest.id).toBe(`1.0.0-${commit.slice(0, 7)}`);
    expect(manifest).toMatchObject({
      version: "1.0.0",
      commit,
      nodeVersion: "v22.15.0",
      status: "candidate",
      lockfile: { file: "pnpm-lock.yaml" },
    });
    expect(manifest.lockfile?.sha256).toMatch(/^[0-9a-f]{64}$/);

    const frozen = path.join(root, ".warlock/releases", manifest.id, "source/package.json");

    expect(JSON.parse(await readFile(frozen, "utf8")).version).toBe("1.0.0");
  });

  it("freezes the given commit, not the working tree", async () => {
    const first = await commitVersion("1.0.0");

    await commitVersion("1.1.0");

    const manifest = await createCandidate(makeContext(), { commit: first });

    expect(manifest.version).toBe("1.0.0");
  });

  it("refuses a dirty tree unless allowed", async () => {
    await commitVersion("1.0.0");
    await writeFile(path.join(root, "stray.txt"), "x");

    await expect(createCandidate(makeContext())).rejects.toThrow(/uncommitted changes/);
    await expect(createCandidate(makeContext(), { allowDirty: true })).resolves.toMatchObject({
      version: "1.0.0",
    });
  });

  it("does not count its own directory as a change, and never overwrites", async () => {
    await commitVersion("1.0.0");
    // Without the ignore rule the release directory would show up as untracked.
    await writeFile(path.join(root, ".gitignore"), "");
    git("add", "-A");
    git("commit", "-m", "unignore");

    const context = makeContext();

    await createCandidate(context);
    await expect(createCandidate(context)).rejects.toThrow(/already exists/);
  });
});

describe("runGate", () => {
  it("runs the checks in order inside the frozen source and records them", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const candidate = await createCandidate(context);
    const manifest = await runGate(context, candidate.id);

    expect(ran.map((entry) => entry.command)).toEqual(["lint", "test", "build"]);
    expect(ran[0]?.cwd).toBe(path.join(root, ".warlock/releases", candidate.id, "source"));
    expect(manifest.status).toBe("gated");
    expect(manifest.gate?.passed).toBe(true);
    expect(manifest.gate?.results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
  });

  it("stops at the first failure and leaves later checks unrecorded", async () => {
    await commitVersion("1.0.0");
    failing.add("test");
    const context = makeContext();
    const candidate = await createCandidate(context);
    const manifest = await runGate(context, candidate.id);

    expect(ran.map((entry) => entry.command)).toEqual(["lint", "test"]);
    expect(manifest.status).toBe("candidate");
    expect(manifest.gate?.passed).toBe(false);
    expect(manifest.gate?.results.map((result) => result.name)).toEqual(["lint", "test"]);
    expect(manifest.gate?.results[1]).toMatchObject({ status: "failed", output: "test exploded" });
    expect((await readManifest(context, candidate.id)).gate?.passed).toBe(false);
  });
});

describe("stageRelease", () => {
  it("refuses a candidate that did not pass the gate", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const candidate = await createCandidate(context);

    await expect(stageRelease(context, candidate.id)).rejects.toThrow(/not passed the gate/);
  });

  it("copies the build, manifest files and identity into staged", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const id = await prepare(context);
    const staged = path.join(root, ".warlock/releases", id, "staged");
    const identity = JSON.parse(await readFile(path.join(staged, "release.json"), "utf8"));

    expect(await readFile(path.join(staged, "dist/app.js"), "utf8")).toContain("app");
    expect(existsSync(path.join(staged, "package.json"))).toBe(true);
    expect(existsSync(path.join(staged, "pnpm-lock.yaml"))).toBe(true);
    expect(identity).toMatchObject({ id, version: "1.0.0" });
    expect((await readManifest(context, id)).status).toBe("staged");
  });

  it("rejects an include entry that leaves the project", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ include: ["../secret"] });
    const candidate = await createCandidate(context);

    await runGate(context, candidate.id);
    await expect(stageRelease(context, candidate.id)).rejects.toThrow(/outside the project/);
    expect(existsSync(path.join(root, ".warlock/releases", candidate.id, "staged"))).toBe(false);
  });
});

describe("activateRelease", () => {
  it("refuses a candidate that is not staged", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const candidate = await createCandidate(context);
    const result = await activateRelease(context, candidate.id);

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "staged")?.ok).toBe(false);
    expect(await readPointer(context, "current")).toBeNull();
  });

  it("switches current with a relative symlink and records the activation", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const id = await prepare(context);
    const result = await activateRelease(context, id);

    expect(result).toMatchObject({ ok: true, switched: true, previousId: null });
    expect(await readlink(path.join(root, ".warlock/current"))).toBe(path.join("releases", id));
    expect((await lstat(path.join(root, ".warlock/current"))).isSymbolicLink()).toBe(true);
    expect((await readManifest(context, id)).status).toBe("active");
    expect((await readLog(context)).some((entry) => entry.event === "activate" && entry.ok)).toBe(
      true,
    );
  });

  it("keeps previous, supersedes the old release and runs only the configured restart", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ restart: { command: "restart-app" } });
    const first = await prepare(context);

    await activateRelease(context, first);
    await commitVersion("1.1.0");

    const second = await prepare(context);
    const result = await activateRelease(context, second);
    const restarts = ran.filter((entry) => entry.command === "restart-app");

    expect(result).toMatchObject({ ok: true, previousId: first, restarted: true });
    expect(await readPointer(context, "previous")).toBe(first);
    expect(await readPointer(context, "current")).toBe(second);
    expect((await readManifest(context, first)).status).toBe("superseded");
    expect(restarts).toHaveLength(2);
    expect(restarts[1]?.env).toMatchObject({ WARLOCK_RELEASE_ID: second });
  });

  it("does nothing beyond the pointer when no restart command is configured", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const id = await prepare(context);
    const before = ran.length;
    const result = await activateRelease(context, id);

    expect(result.restarted).toBeNull();
    expect(ran).toHaveLength(before);
  });

  it("requires a strictly greater version", async () => {
    await commitVersion("1.1.0");
    const context = makeContext();
    const active = await prepare(context);

    await activateRelease(context, active);

    // Equal version, different commit.
    await writeFile(path.join(root, "note.txt"), "x");
    git("add", "-A");
    git("commit", "-m", "same version");

    const same = await prepare(context);
    const refused = await activateRelease(context, same);

    expect(refused.ok).toBe(false);
    expect(refused.checks.find((check) => check.name === "version")?.detail).toMatch(/equals/);

    const allowed = await activateRelease(context, same, { allowSame: true });

    expect(allowed.ok).toBe(true);

    // A lower version is refused even with allowSame.
    await commitVersion("1.0.0");

    const lower = await prepare(context);
    const lowerResult = await activateRelease(context, lower, { allowSame: true });

    expect(lowerResult.ok).toBe(false);
    expect(lowerResult.checks.find((check) => check.name === "version")?.detail).toMatch(/lower/);
    expect(await readPointer(context, "current")).toBe(same);
  });

  it("compares versions as numbers", async () => {
    await commitVersion("1.2.0");
    const context = makeContext();

    await activateRelease(context, await prepare(context));
    await commitVersion("1.10.0");

    expect((await activateRelease(context, await prepare(context))).ok).toBe(true);
  });

  it("changes nothing on --preflight or --dry-run", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ restart: { command: "restart-app" } });
    const id = await prepare(context);

    const preflight = await activateRelease(context, id, { preflightOnly: true });
    const dry = await activateRelease(context, id, { dryRun: true });

    expect(preflight).toMatchObject({ ok: true, switched: false });
    expect(dry).toMatchObject({ ok: true, switched: false, dryRun: true });
    expect(await readPointer(context, "current")).toBeNull();
    expect(ran.some((entry) => entry.command === "restart-app")).toBe(false);
  });

  it("keeps the new pointer and says so when the restart command fails", async () => {
    await commitVersion("1.0.0");
    failing.add("restart-app");
    const context = makeContext({ restart: { command: "restart-app" } });
    const id = await prepare(context);
    const result = await activateRelease(context, id);

    expect(result).toMatchObject({ ok: false, switched: true, restarted: false });
    expect(result.message).toMatch(/release rollback/);
    expect(await readPointer(context, "current")).toBe(id);
  });
});

describe("rollbackRelease", () => {
  it("has nothing to do without a previous release", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();

    await activateRelease(context, await prepare(context));

    expect(await rollbackRelease(context)).toMatchObject({ ok: false, switched: false });
  });

  it("switches back, reruns the restart command and flips on a second rollback", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ restart: { command: "restart-app" } });
    const first = await prepare(context);

    await activateRelease(context, first);
    await commitVersion("1.1.0");

    const second = await prepare(context);

    await activateRelease(context, second);
    ran.length = 0;

    const dry = await rollbackRelease(context, { dryRun: true });

    expect(dry).toMatchObject({ ok: true, switched: false });
    expect(await readPointer(context, "current")).toBe(second);

    const result = await rollbackRelease(context);

    expect(result).toMatchObject({ ok: true, from: second, to: first, restarted: true });
    expect(await readPointer(context, "current")).toBe(first);
    expect(await readPointer(context, "previous")).toBe(second);
    expect((await readManifest(context, first)).status).toBe("active");
    expect(ran.filter((entry) => entry.command === "restart-app")).toHaveLength(1);
    expect((await readLog(context)).at(-1)).toMatchObject({ event: "rollback", ok: true });

    await rollbackRelease(context);

    expect(await readPointer(context, "current")).toBe(second);
  });
});

describe("pruneReleases", () => {
  it("keeps the newest, current and previous; removes only when asked", async () => {
    const context = makeContext();
    const ids: string[] = [];

    for (const version of ["1.0.0", "1.1.0", "1.2.0", "1.3.0"]) {
      await commitVersion(version);
      ids.push(await prepare(context));
    }

    await activateRelease(context, ids[0]!);
    await activateRelease(context, ids[1]!);

    const dry = await pruneReleases(context, { keep: 1, dryRun: true });

    expect(dry.removed).toEqual([ids[2]]);
    expect((await listReleases(context)).releases).toHaveLength(4);

    const result = await pruneReleases(context, { keep: 1 });

    expect(result.removed).toEqual([ids[2]]);
    expect((await listReleases(context)).releases.map((release) => release.id).sort()).toEqual(
      [ids[0], ids[1], ids[3]].sort(),
    );
    expect(existsSync(path.join(root, ".warlock/releases", ids[2]!))).toBe(false);
  });

  it("rejects a keep count below one", async () => {
    await expect(pruneReleases(makeContext(), { keep: 0 })).rejects.toThrow(/at least 1/);
  });
});

describe("verifyRelease", () => {
  let server: Server;
  let url: string;
  let requests: number;
  let body: () => { status: number; json: unknown };

  beforeEach(async () => {
    requests = 0;
    server = createServer((_request, response) => {
      requests += 1;
      const { status, json } = body();

      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(json));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/health`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function activeContext() {
    const commit = await commitVersion("2.0.0");
    const context = makeContext({
      verify: { url, retries: 3, intervalMs: 5, timeoutMs: 1000 },
    });

    await activateRelease(context, await prepare(context));

    return { context, commit };
  }

  it("passes when status, version and commit match", async () => {
    const { context, commit } = await activeContext();

    body = () => ({ status: 200, json: { version: "2.0.0", commit: commit.slice(0, 7) } });

    const result = await verifyRelease(context);

    expect(result).toMatchObject({ ok: true, attempts: 1 });
    expect((await readManifest(context, result.id)).verification?.ok).toBe(true);
  });

  it("retries until the new version answers", async () => {
    const { context, commit } = await activeContext();

    body = () => ({
      status: 200,
      json: { version: requests < 3 ? "1.9.0" : "2.0.0", commit },
    });

    expect(await verifyRelease(context)).toMatchObject({ ok: true, attempts: 3 });
  });

  it("fails with the reason after the retries run out", async () => {
    const { context } = await activeContext();

    body = () => ({ status: 503, json: {} });

    const result = await verifyRelease(context);

    expect(result).toMatchObject({ ok: false, attempts: 4 });
    expect(result.reason).toMatch(/status 503/);
    expect((await readManifest(context, result.id)).verification?.ok).toBe(false);
  });

  it("fails when the response does not report a version", async () => {
    const { context } = await activeContext();

    body = () => ({ status: 200, json: { status: "ok" } });

    expect((await verifyRelease(context)).reason).toMatch(/reports no version/);
  });

  it("needs a URL and an active release", async () => {
    await commitVersion("2.0.0");

    await expect(verifyRelease(makeContext())).rejects.toThrow(/No active release/);
  });
});

describe("proveMigrations", () => {
  function fakeDatabase(options: { apply?: string[]; indexOnRun?: boolean } = {}) {
    const state = {
      executed: ["001-users"],
      tables: ["users"],
      indexes: { users: ["email_1"] } as Record<string, string[]>,
    };
    const pending = ["002-orders"];
    const provider: MigrationProofProvider = {
      listExecuted: async () => [...state.executed],
      listPending: async () => (state.executed.includes("002-orders") ? [] : pending),
      listTables: async () => [...state.tables],
      listIndexes: async (table) => [...(state.indexes[table] ?? [])],
      runPending: async () => {
        const applied = options.apply ?? pending;

        state.executed.push(...applied);
        state.tables.push("orders");
        state.indexes.orders = ["orders_user_1"];
        if (options.indexOnRun) state.indexes.users = ["email_1", "name_1"];

        return applied;
      },
    };

    return provider;
  }

  it("records the before and after state and passes on the expected set", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ migrations: { expectedTables: ["orders"] } });
    const candidate = await createCandidate(context);
    const proof = await proveMigrations(context, fakeDatabase({ indexOnRun: true }), {
      target: "staging",
      releaseId: candidate.id,
    });

    expect(proof.passed).toBe(true);
    expect(proof.applied).toEqual(["002-orders"]);
    expect(proof.before.executed).toEqual(["001-users"]);
    expect(proof.after.executed).toEqual(["001-users", "002-orders"]);
    expect(proof.tablesAdded).toEqual(["orders"]);
    expect(proof.indexesChanged).toEqual({
      users: { added: ["name_1"], removed: [] },
      orders: { added: ["orders_user_1"], removed: [] },
    });
    expect((await readManifest(context, candidate.id)).migrations?.target).toBe("staging");
  });

  it("fails when something other than the expected set ran", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ migrations: { expected: ["002-orders"] } });
    const candidate = await createCandidate(context);
    const proof = await proveMigrations(context, fakeDatabase({ apply: ["003-surprise"] }), {
      target: null,
      releaseId: candidate.id,
    });

    expect(proof.passed).toBe(false);
    expect(proof.problems.join("\n")).toMatch(/expected \[002-orders\]/);
  });

  it("fails when an expected table is missing and blocks activation", async () => {
    await commitVersion("1.0.0");
    const context = makeContext({ migrations: { expectedTables: ["invoices"] } });
    const id = await prepare(context);
    const proof = await proveMigrations(context, fakeDatabase(), { target: null, releaseId: id });

    expect(proof.problems).toContain('Expected table "invoices" is missing.');

    const result = await activateRelease(context, id);

    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === "migrations")?.ok).toBe(false);
  });
});

describe("runReleaseAction", () => {
  const unusedMigrations = async () => {
    throw new Error("database must not be opened");
  };

  it("rejects an unknown action and options that do not belong to it", async () => {
    const context = makeContext();

    await expect(
      runReleaseAction(
        { args: ["launch"], options: {} },
        { context, openMigrations: unusedMigrations },
      ),
    ).rejects.toThrow(/Usage: warlock release/);
    await expect(
      runReleaseAction(
        { args: ["gate"], options: { dryRun: true } },
        { context, openMigrations: unusedMigrations },
      ),
    ).rejects.toThrow(/Unsupported option for release gate: --dryRun/);
  });

  it("drives the pipeline and lists the result", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    const dependencies = { context, openMigrations: unusedMigrations };
    const run = (args: string[], options = {}) => runReleaseAction({ args, options }, dependencies);

    expect((await run(["candidate"])).ok).toBe(true);
    expect((await run(["gate"])).ok).toBe(true);
    expect((await run(["stage"])).ok).toBe(true);
    expect((await run(["activate"], { dryRun: true })).lines.join("\n")).toMatch(/Dry run/);
    expect((await run(["activate"])).ok).toBe(true);

    const listing = await run(["list"]);

    expect(listing.lines[0]).toMatch(/current/);
    expect((await run(["status"])).lines[0]).toMatch(/^Active: 1\.0\.0-/);
    expect((await run(["rollback"])).ok).toBe(false);
  });

  it("shows the migration plan without running anything unless --prove is passed", async () => {
    await commitVersion("1.0.0");
    const context = makeContext();
    let runs = 0;
    const executed: string[] = [];
    const provider: MigrationProofProvider = {
      listExecuted: async () => [...executed],
      listPending: async () => ["001-users"],
      listTables: async () => [],
      listIndexes: async () => [],
      runPending: async () => {
        runs += 1;
        executed.push("001-users");

        return ["001-users"];
      },
    };

    await createCandidate(context);

    const plan = await runReleaseAction(
      { args: ["migrations"], options: {} },
      { context, openMigrations: async () => provider },
    );

    expect(plan.lines[0]).toMatch(/001-users/);
    expect(runs).toBe(0);

    const proved = await runReleaseAction(
      { args: ["migrations"], options: { prove: true } },
      { context, openMigrations: async () => provider },
    );

    expect(proved.ok).toBe(true);
    expect(runs).toBe(1);
  });
});
