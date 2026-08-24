import { env, resetEnv } from "@mongez/dotenv";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEnvironmentFiles, resetLoadedEnvironment } from "../../../src/utils/load-environment";

/**
 * Deliberately NOT mocking `@mongez/dotenv` (unlike the sibling
 * `load-environment.test.ts`, which only cares about how often the loader is
 * called). Precedence is decided inside the real loader, so a mock would assert
 * nothing about the behaviour under test.
 *
 * Every test uses its own key: the loader keeps module-level state that
 * survives between tests in the same process.
 */
describe("env precedence", () => {
  let directory: string;
  const touchedKeys: string[] = [];

  const setProcessValue = (key: string, value: string) => {
    touchedKeys.push(key);
    process.env[key] = value;
  };

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "warlock-env-precedence-"));
    resetLoadedEnvironment();
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    for (const key of touchedKeys) delete process.env[key];
    touchedKeys.length = 0;
    resetEnv();
    rmSync(directory, { recursive: true, force: true });
  });

  it("keeps a value the process environment already carries", async () => {
    // The `.env` file is the checked-in default; an exported variable is the
    // deliberate, situational override — a second instance on another port, a
    // CI database, a container's configuration. The default must not win.
    setProcessValue("WARLOCK_PRECEDENCE_PORT", "6060");
    writeFileSync(path.join(directory, ".env"), "WARLOCK_PRECEDENCE_PORT=3000\n");

    await loadEnvironmentFiles(directory);

    expect(env("WARLOCK_PRECEDENCE_PORT")).toBe(6060);
    expect(process.env.WARLOCK_PRECEDENCE_PORT).toBe("6060");
  });

  it("still supplies keys the process environment does not have", async () => {
    // Winning must not mean shadowing: the file is a fallback layer, not a
    // no-op. Every key absent from the environment still comes from the file.
    writeFileSync(path.join(directory, ".env"), "WARLOCK_PRECEDENCE_ONLY_IN_FILE=from-file\n");

    await loadEnvironmentFiles(directory);

    expect(env("WARLOCK_PRECEDENCE_ONLY_IN_FILE")).toBe("from-file");
  });

  it("treats an exported empty value as set, not as absent", async () => {
    // `KEY=` in the environment is SET-TO-EMPTY and beats the file. See the
    // rationale on `environmentLoaderOptions` in src/utils/load-environment.ts.
    setProcessValue("WARLOCK_PRECEDENCE_EMPTY", "");
    writeFileSync(path.join(directory, ".env"), "WARLOCK_PRECEDENCE_EMPTY=from-file\n");

    await loadEnvironmentFiles(directory);

    expect(env("WARLOCK_PRECEDENCE_EMPTY")).toBe("");
  });
});
