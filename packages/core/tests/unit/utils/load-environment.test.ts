import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadEnvMock = vi.hoisted(() => vi.fn());

vi.mock("@mongez/dotenv", () => ({
  loadEnv: loadEnvMock,
}));

const { loadEnvironmentFiles, resetLoadedEnvironment } = await import(
  "../../../src/utils/load-environment"
);

describe("loadEnvironmentFiles", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "warlock-env-"));
    loadEnvMock.mockClear();
    resetLoadedEnvironment();
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads env when a .env file exists", async () => {
    writeFileSync(path.join(directory, ".env"), "APP_NAME=warlock\n");

    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).toHaveBeenCalledTimes(1);
  });

  it("loads env when only .env.shared exists", async () => {
    writeFileSync(path.join(directory, ".env.shared"), "APP_NAME=warlock\n");

    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).toHaveBeenCalledTimes(1);
  });

  it("loads env when only the NODE_ENV-specific file exists", async () => {
    process.env.NODE_ENV = "production";
    writeFileSync(path.join(directory, ".env.production"), "APP_NAME=warlock\n");

    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the project has no env file", async () => {
    // The regression this guards: `loadEnv()` throws on a missing file, and
    // env is now loaded for every command. Unguarded, a project that never had
    // a `.env` would find `warlock build` newly crashing.
    await expect(loadEnvironmentFiles(directory)).resolves.toBeUndefined();

    expect(loadEnvMock).not.toHaveBeenCalled();
  });

  it("loads at most once per process, however many callers ask", async () => {
    // Both the CLI preload phase and `bootstrap()` call this on a bootstrapping
    // command. `loadEnv` overrides by default, so a second pass would re-write
    // `process.env` and clobber anything set in between — a config module body,
    // a config file, the files orchestrator.
    writeFileSync(path.join(directory, ".env"), "APP_NAME=warlock\n");

    await loadEnvironmentFiles(directory);
    await loadEnvironmentFiles(directory);
    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).toHaveBeenCalledTimes(1);
  });

  it("does not latch when it found nothing to load", async () => {
    // Nothing was overridden, so there is nothing to protect — and a project
    // may create its `.env` between a command's preload and its bootstrap.
    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).not.toHaveBeenCalled();

    writeFileSync(path.join(directory, ".env"), "APP_NAME=warlock\n");
    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a NODE_ENV file that does not exist", async () => {
    process.env.NODE_ENV = "staging";

    await loadEnvironmentFiles(directory);

    expect(loadEnvMock).not.toHaveBeenCalled();
  });
});
