import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadEnvironmentFiles, resetLoadedEnvironment } from "../../../src/utils/load-environment";

/**
 * Exercises the diagnostic end to end through `loadEnvironmentFiles()`
 * (rather than unit-testing `detectEnvironmentOverrides` /
 * `reportEnvironmentOverrides` in isolation) because the card's defect was
 * observable only at that boundary: an app whose `.env` said `HTTP_PORT=2030`
 * booted on an ambient `HTTP_PORT=41900` with nothing printed anywhere.
 */
describe("environment override reporting", () => {
  let directory: string;
  const touchedKeys: string[] = [];
  let warnSpy: ReturnType<typeof vi.spyOn>;

  const setProcessValue = (key: string, value: string) => {
    touchedKeys.push(key);
    process.env[key] = value;
  };

  // This machine's own shell exports `HTTP_PORT` (the exact ambient value the
  // card's bug report used, `41900`) — the card's own reproduction, alive in
  // the test runner's environment. Every "innocent" test below uses
  // `HTTP_PORT` as its key, so the ambient value must be cleared before each
  // test and restored after, or the suite would spuriously "reproduce" the
  // defect case in tests that never asked for it.
  let originalHttpPort: string | undefined;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), "warlock-env-overrides-"));
    resetLoadedEnvironment();
    delete process.env.NODE_ENV;
    originalHttpPort = process.env.HTTP_PORT;
    delete process.env.HTTP_PORT;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();

    for (const key of touchedKeys) {
      delete process.env[key];
    }

    touchedKeys.length = 0;

    if (originalHttpPort === undefined) {
      delete process.env.HTTP_PORT;
    } else {
      process.env.HTTP_PORT = originalHttpPort;
    }

    rmSync(directory, { recursive: true, force: true });
  });

  describe("innocent cases — nothing printed", () => {
    it("prints nothing when no ambient variable is set at all", async () => {
      writeFileSync(path.join(directory, ".env"), "HTTP_PORT=2030\n");

      await loadEnvironmentFiles(directory);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("prints nothing for an ambient variable the .env file does not mention", async () => {
      setProcessValue("WARLOCK_OVERRIDES_UNRELATED", "anything");
      writeFileSync(path.join(directory, ".env"), "HTTP_PORT=2030\n");

      await loadEnvironmentFiles(directory);

      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("prints nothing when the ambient value is identical to the file's", async () => {
      setProcessValue("HTTP_PORT", "2030");
      writeFileSync(path.join(directory, ".env"), "HTTP_PORT=2030\n");

      await loadEnvironmentFiles(directory);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  it("prints exactly one line naming the effective value and the value that lost", async () => {
    setProcessValue("HTTP_PORT", "41900");
    writeFileSync(path.join(directory, ".env"), "HTTP_PORT=2030\n");

    await loadEnvironmentFiles(directory);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [line] = warnSpy.mock.calls[0];

    expect(line).toContain("HTTP_PORT");
    expect(line).toContain("41900");
    expect(line).toContain("2030");
  });

  it("names a secret-shaped key but redacts both values", async () => {
    setProcessValue("DB_PASSWORD", "ambient-secret");
    writeFileSync(path.join(directory, ".env"), "DB_PASSWORD=file-secret\n");

    await loadEnvironmentFiles(directory);

    expect(warnSpy).toHaveBeenCalledTimes(1);

    const [line] = warnSpy.mock.calls[0];

    expect(line).toContain("DB_PASSWORD");
    expect(line).not.toContain("ambient-secret");
    expect(line).not.toContain("file-secret");
    expect(line).toContain("<redacted>");
  });
});
