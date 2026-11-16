import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", npmVersion: "11.7.0", installFails: true }));

vi.mock("../utils", () => ({
  rootPath: (...parts: string[]) => path.join(state.root, ...parts),
}));
vi.mock("../utils/npm-registry", () => ({ fetchLatestVersion: async () => "9.9.9" }));
vi.mock("../release-notes/release-notes", () => ({ releaseNotesPointer: () => "" }));
vi.mock("./package-manager", () => ({
  detectPackageManager: async () => "npm",
  detectPackageManagerDetails: async () => ({
    packageManager: "npm",
    ambiguous: [],
    reason: "test",
  }),
  getInstallCommand: () => "npm install",
}));
vi.mock("node:child_process", () => ({
  execSync: (command: string) => {
    if (command.startsWith("npm --version")) return `${state.npmVersion}\n`;
    if (state.installFails) throw new Error("npm crashed");

    return "";
  },
}));

import { updateWarlockPackages } from "./update-warlock-packages";

const PACKAGE_JSON = `{\n  "name": "app",\n  "dependencies": { "@warlock.js/core": "^1.0.0" }\n}\n`;
const LOCKFILE = `{"lockfileVersion":3,"packages":{"node_modules/@warlock.js/core":{"version":"1.0.0"}}}`;

describe("updateWarlockPackages install failures", () => {
  beforeEach(() => {
    state.root = mkdtempSync(path.join(os.tmpdir(), "warlock-update-"));
    state.npmVersion = "11.7.0";
    state.installFails = true;
    writeFileSync(path.join(state.root, "package.json"), PACKAGE_JSON);
    writeFileSync(path.join(state.root, "package-lock.json"), LOCKFILE);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(state.root, { recursive: true, force: true });
  });

  it("puts package.json and the lockfile back when the install fails", async () => {
    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("install-failed");
    expect(readFileSync(path.join(state.root, "package.json"), "utf8")).toBe(PACKAGE_JSON);
    expect(readFileSync(path.join(state.root, "package-lock.json"), "utf8")).toBe(LOCKFILE);
  });

  it("keeps the new versions when the install succeeds", async () => {
    state.installFails = false;

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("updated");
    expect(readFileSync(path.join(state.root, "package.json"), "utf8")).toContain("^9.9.9");
  });

  it("refuses an npm that is too old before changing anything", async () => {
    state.npmVersion = "10.9.9";

    const result = await updateWarlockPackages();

    expect(result.outcome).toBe("npm-too-old");
    expect(result.error?.message).toContain("npm 10.9.9");
    expect(result.error?.message).toContain("11.6.2");
    expect(readFileSync(path.join(state.root, "package.json"), "utf8")).toBe(PACKAGE_JSON);
  });

  it("lets --no-install through with an old npm", async () => {
    state.npmVersion = "10.9.9";

    const result = await updateWarlockPackages({ install: false });

    expect(result.outcome).toBe("updated");
  });
});
