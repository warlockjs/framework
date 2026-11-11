import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DoctorBootContext } from "../check.types";
import { envFilesCheck } from "./env-files.check";

const bootContext = {} as DoctorBootContext;

let root: string;

/** Git settings that would let the machine's own config ignore files for the test. */
const GIT_ENV_KEYS = ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "XDG_CONFIG_HOME"] as const;
const savedEnv: Partial<Record<(typeof GIT_ENV_KEYS)[number], string | undefined>> = {};

async function run() {
  return await envFilesCheck.run(bootContext);
}

function write(name: string, contents = ""): void {
  writeFileSync(path.join(root, name), contents);
}

function gitInit(): void {
  spawnSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "warlock-env-doctor-"));
  vi.spyOn(process, "cwd").mockReturnValue(root);

  for (const key of GIT_ENV_KEYS) savedEnv[key] = process.env[key];

  // Keep the machine's global and system git config (and its global excludes
  // file) out of the answer.
  process.env.GIT_CONFIG_GLOBAL = path.join(root, ".no-global-gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  process.env.XDG_CONFIG_HOME = path.join(root, ".no-xdg");
});

afterEach(() => {
  vi.restoreAllMocks();

  for (const key of GIT_ENV_KEYS) {
    const value = savedEnv[key];

    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  rmSync(root, { recursive: true, force: true });
});

describe("doctor env-files check", () => {
  it("is ok when every env file is ignored", async () => {
    gitInit();
    write(".gitignore", ".env\n.env.*\n!.env.example\n");
    write(".env");
    write(".env.production");
    write(".env.example");

    const result = await run();

    expect(result?.status).toBe("ok");
    expect(result?.detail).toContain(".env.production");
  });

  it("warns when .gitignore ignores only .env and a .env.* file exists", async () => {
    gitInit();
    write(".gitignore", ".env\n");
    write(".env");
    write(".env.production");

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.detail).toContain(".env.production is not ignored");
    expect(result?.detail).not.toContain(".env,");
    expect(result?.detail).toContain(".env.*");
  });

  it("warns when there is no .gitignore at all", async () => {
    gitInit();
    write(".env.local");

    expect((await run())?.status).toBe("warn");
  });

  it("is silent when the only env file is a template", async () => {
    gitInit();
    write(".env.example");

    expect(await run()).toBeUndefined();
  });

  it("is silent outside a git work tree", async () => {
    write(".env.production");

    expect(await run()).toBeUndefined();
  });
});
