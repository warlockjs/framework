import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserCandidates, findBrowserBinary } from "./browser";
import { AppFixture, isolatedEnvironment } from "./fixture";
import { commandLineOwns } from "./owned-process";
import type { E2EEvidence } from "./types";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function evidence(): E2EEvidence {
  return {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    status: "running",
    steps: [],
    console: [],
    networkFailures: [],
    screenshots: [],
    processes: [],
    errors: [],
  };
}
async function tempDirectory() {
  const root = await mkdtemp(join(tmpdir(), "warlock-fixture-spec-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
const server = `
import {createServer} from 'node:http';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const engine=process.platform==='win32'?'windows-fixture':execFileSync('fixture-engine',{encoding:'utf8'}).trim();
const app=createServer((_req,res)=>res.end(JSON.stringify({data:process.env.WARLOCK_E2E_DATA_ROOT,custom:process.env.ONLY_FIXTURE,ambient:process.env.PRIVATE_AMBIENT,home:process.env.HOME,marker:readFileSync('built','utf8'),engine})));
app.listen(0,'127.0.0.1',()=>writeFileSync(process.env.WARLOCK_E2E_PORT_FILE,String(app.address().port)));
`;

describe("owned app fixture", () => {
  it("copies app files without dotenv/symlinks and owns build, data, env and an actual port-0 server", async () => {
    const source = await tempDirectory();
    await writeFile(join(source, "fixture.mjs"), server);
    await writeFile(join(source, ".env"), "PRIVATE=production\n");
    const shared = await tempDirectory();
    await writeFile(join(shared, "secret"), "shared");
    if (process.platform !== "win32") await symlink(shared, join(source, "shared-data"));
    vi.stubEnv("PRIVATE_AMBIENT", "not inherited");
    const report = evidence();
    const fixture = await AppFixture.create(report);
    cleanups.push(() => fixture.stop());
    const context = await fixture.start(
      {
        directory: source,
        portFromFile: true,
        build: [
          process.execPath,
          "-e",
          "require('node:fs').writeFileSync('built','fixture-build')",
        ],
        start: [process.execPath, "fixture.mjs"],
        env: { ONLY_FIXTURE: "yes" },
        path: ["fake-bin"],
        prepare: async ({ directory }) => {
          await mkdir(join(directory, "fake-bin"));
          await writeFile(
            join(directory, "fake-bin", "fixture-engine"),
            `#!${process.execPath}\nconsole.log("fixture-engine-result");\n`,
            { mode: 0o755 },
          );
          await expect(access(join(directory, ".env"))).rejects.toThrow();
          if (process.platform !== "win32")
            await expect(access(join(directory, "shared-data"))).rejects.toThrow();
        },
      },
      {},
    );
    const body = (await fetch(context.url).then((response) => response.json())) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      data: context.dataRoot,
      custom: "yes",
      marker: "fixture-build",
      engine: process.platform === "win32" ? "windows-fixture" : "fixture-engine-result",
      home: join(fixture.root, "home"),
    });
    expect(body).not.toHaveProperty("ambient");
    expect(context.port).toBeGreaterThan(0);
    expect(
      report.processes
        .filter(({ role }) => role === "app" || role === "build")
        .every(({ pid, childPid }) => pid > 0 && typeof childPid === "number"),
    ).toBe(true);
    await fixture.stop();
    expect(report.processes.every(({ stopped }) => stopped)).toBe(true);
    await expect(access(fixture.root)).rejects.toThrow();
    expect(await readFile(join(shared, "secret"), "utf8")).toBe("shared");
    await expect(access(join(source, "built"))).rejects.toThrow();
  });

  it("preserves a build failure and still stops its owned group", async () => {
    const source = await tempDirectory();
    await writeFile(join(source, "entry.txt"), "fixture");
    const report = evidence();
    const fixture = await AppFixture.create(report);
    cleanups.push(() => fixture.stop());
    await expect(
      fixture.start(
        {
          directory: source,
          build: [
            process.execPath,
            "-e",
            "process.stderr.write('deliberate build failure');process.exit(7)",
          ],
        },
        {},
      ),
    ).rejects.toThrow("deliberate build failure");
    await fixture.stop();
    expect(report.processes[0].stopped).toBe(true);
  });

  it("prepends fake binary directories without inheriting service secrets", () => {
    vi.stubEnv("PRIVATE_AMBIENT", "secret");
    const env = isolatedEnvironment("/owned", { ONLY_FIXTURE: "yes" }, ["/owned/fakes"]);
    expect(env.PRIVATE_AMBIENT).toBeUndefined();
    expect(env.ONLY_FIXTURE).toBe("yes");
    expect(env.PATH?.split(delimiter)[0]).toBe("/owned/fakes");
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it("gives Windows programs an owned app-data folder instead of the user's", () => {
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\someone\\AppData\\Local");
    vi.stubEnv("ProgramFiles", "C:\\Program Files");
    const env = isolatedEnvironment("/owned", {}, [], "win32");
    expect(env.LOCALAPPDATA).toContain("owned");
    expect(env.LOCALAPPDATA).not.toContain("someone");
    expect(env.APPDATA).toContain("owned");
    expect(env.ProgramFiles).toBe("C:\\Program Files");
    expect(isolatedEnvironment("/owned", {}, [], "linux").LOCALAPPDATA).toBeUndefined();
  });

  it("requires the recorded unique owner path, rather than a process name or port", () => {
    expect(commandLineOwns("node\0/owned/owner-unique.mjs\0", "/owned/owner-unique.mjs")).toBe(
      true,
    );
    expect(commandLineOwns("node\0/other/owner-unique.mjs\0", "/owned/owner-unique.mjs")).toBe(
      false,
    );
    expect(
      commandLineOwns("node\0/owned/owner-unique.mjs.backup\0", "/owned/owner-unique.mjs"),
    ).toBe(false);
  });

  it("discovers OS installation candidates and fails closed on a bad override", async () => {
    expect(browserCandidates("darwin", {})).toContain(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    expect(
      browserCandidates("win32", { PROGRAMFILES: "C:/Program Files" }).some((file) =>
        file.endsWith("msedge.exe"),
      ),
    ).toBe(true);
    expect(browserCandidates("linux", { PATH: "/owned/bin" })).toContain(
      "/owned/bin/google-chrome",
    );
    await expect(findBrowserBinary(join(await tempDirectory(), "missing-browser"))).rejects.toThrow(
      "Browser override is not executable",
    );
  });

  it("rejects escaping fixture exclusions before spawning a process", async () => {
    const source = await tempDirectory();
    await mkdir(join(source, "app"));
    const report = evidence();
    const fixture = await AppFixture.create(report);
    cleanups.push(() => fixture.stop());
    await expect(fixture.start({ directory: source, exclude: ["../shared"] }, {})).rejects.toThrow(
      "relative paths",
    );
    expect(report.processes).toEqual([]);
  });
});
