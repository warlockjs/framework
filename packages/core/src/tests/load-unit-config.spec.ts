import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadUnitConfig } from "./load-unit-config";

const values = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../config/config-setter", () => ({
  setConfig: (key: string, value: unknown) => values.set(key, value),
}));
const location = vi.hoisted(() => ({ directory: "" }));
vi.mock("../utils/paths", () => ({ srcPath: () => location.directory }));
afterEach(async () => {
  if (location.directory)
    await rm(path.dirname(location.directory), { recursive: true, force: true });
  values.clear();
});

describe("unit config loading", () => {
  it("imports config values through Vitest without special handlers or source graph discovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "warlock-unit-config-"));
    location.directory = path.join(root, "config");
    await mkdir(location.directory);
    await writeFile(path.join(location.directory, "tests.ts"), "export default {};");
    await writeFile(path.join(location.directory, "types.d.ts"), "export type Flag = boolean;");
    const importer = vi.fn(async () => ({ default: { lifetime: "file" } }));
    await loadUnitConfig(importer);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(importer).toHaveBeenCalledWith(
      pathToFileURL(path.join(location.directory, "tests.ts")).href,
    );
    expect(values.get("tests")).toEqual({ lifetime: "file" });
  });
  it("allows a project with no config directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "warlock-unit-config-"));
    location.directory = path.join(root, "missing");
    const importer = vi.fn(async () => ({}));
    await loadUnitConfig(importer);
    expect(importer).not.toHaveBeenCalled();
  });
});
