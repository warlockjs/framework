import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const oxlint = path.join(packageRoot, "node_modules/oxlint/bin/oxlint");

describe("design-system template lint", () => {
  // `warlock dev` lints the app with the scaffolded config, so the files the
  // design system copies into an app must pass that same config.
  it("passes the scaffolded app's Oxlint config", () => {
    const result = spawnSync(
      process.execPath,
      [
        oxlint,
        "-c",
        path.join(packageRoot, "templates/warlock/.oxlintrc.json"),
        path.join(packageRoot, "templates/design-system/src"),
      ],
      { encoding: "utf8" },
    );

    expect(result.stdout + result.stderr).not.toMatch(/error/);
    expect(result.status).toBe(0);
  });
});
