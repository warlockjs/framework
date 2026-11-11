import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCommandAction } from "./add-command.action";
import { endGenerationRun } from "./generation-run";

let root: string;
let previous: string;

async function writePackageJson(content: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(root, "package.json"), JSON.stringify(content));
}

async function readPackageJson(): Promise<{
  dependencies?: Record<string, string>;
  agentKit?: { pick?: Record<string, unknown> };
}> {
  return JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
}

beforeEach(async () => {
  previous = process.cwd();
  root = await mkdtemp(path.join(tmpdir(), "warlock-add-agent-kit-"));
  process.chdir(root);
  await mkdir(path.join(root, "src/app"), { recursive: true });
  await writeFile(path.join(root, "src/app/main.ts"), "// application startup\n");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  endGenerationRun({ ok: true });
  process.chdir(previous);
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const add = () => addCommandAction({ args: ["process"], options: { noInstall: true } });

describe("warlock add keeps the agent-kit skills allowlist current", () => {
  it("adds the framework package it installs to an existing agentKit.pick", async () => {
    await writePackageJson({
      name: "example-app",
      dependencies: {},
      agentKit: { pick: { "@warlock.js/core": true, "@my-org/lib": ["only-this"] } },
    });

    await add();

    const packageJson = await readPackageJson();

    expect(packageJson.dependencies?.["@warlock.js/process"]).toBeDefined();
    expect(packageJson.agentKit?.pick).toEqual({
      "@warlock.js/core": true,
      "@my-org/lib": ["only-this"],
      "@warlock.js/process": true,
    });
  });

  it("leaves a project without an allowlist alone", async () => {
    await writePackageJson({ name: "example-app", dependencies: {} });

    await add();

    expect((await readPackageJson()).agentKit).toBeUndefined();
  });

  it("keeps an entry the developer narrowed to specific skills", async () => {
    await writePackageJson({
      name: "example-app",
      dependencies: {},
      agentKit: { pick: { "@warlock.js/process": ["supervise-processes"] } },
    });

    await add();

    expect((await readPackageJson()).agentKit?.pick).toEqual({
      "@warlock.js/process": ["supervise-processes"],
    });
  });
});
