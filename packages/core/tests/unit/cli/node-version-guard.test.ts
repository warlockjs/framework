import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runCli(version: string, published: boolean) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "warlock-node-guard-"));
  directories.push(directory);
  mkdirSync(path.join(directory, "bin"));
  writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
  copyFileSync(path.resolve("bin/warlock.js"), path.join(directory, "bin/warlock.js"));
  if (published) {
    mkdirSync(path.join(directory, "esm/cli"), { recursive: true });
    writeFileSync(path.join(directory, "esm/cli/start.mjs"), 'console.log("CLI started");');
  }
  const preload = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });`;
  return spawnSync(
    process.execPath,
    ["--import", `data:text/javascript,${encodeURIComponent(preload)}`, "bin/warlock.js"],
    { cwd: directory, encoding: "utf8" },
  );
}

describe.each([false, true])("CLI Node version guard (published: %s)", (published) => {
  it.each(["18.20.0", "20.19.0", "22.13.0", "22.14.9"])(
    "rejects Node %s before loading the CLI",
    (version) => {
      const result = runCli(version, published);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`[warlock] requires Node 22.15 or newer (running ${version}).\n`);
    },
  );
});

it.each(["22.15.0", "22.16.0", "23.0.0", "24.0.0"])(
  "starts the published CLI on supported Node %s",
  (version) => {
    const result = runCli(version, true);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("CLI started\n");
    expect(result.stderr).toBe("");
  },
);
