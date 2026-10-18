import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("deprecated ESLint health checker", () => {
  it("stays off despite an app config and warns only once when explicitly selected", async () => {
    vi.resetModules();
    const { defaultHealthCheckers } = await import("./default-health-checkers");
    const root = mkdtempSync(path.join(os.tmpdir(), "warlock-eslint-opt-in-"));
    roots.push(root);
    writeFileSync(path.join(root, "eslint.config.mts"), "export default [];\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(defaultHealthCheckers({}, root).map(({ name }) => name)).toEqual(["TypeScript"]);
    expect(warn).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      const checker = defaultHealthCheckers({ typescript: false, eslint: true }, root)[0];
      expect(checker?.name).toBe("ESLint");
      expect(checker?.workerPath).toBe("./workers/eslint-health.worker");
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("5.34.0");
    expect(warn.mock.calls[0]?.[0]).toContain("npx warlock upgrade --from 5.32 --to 5.33.0");
  });
});
