import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { viteVitest } from "./codemods/vite-vitest";
import { runUpgrade } from "./run-upgrade";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function app(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "warlock-upgrade-vite-"));
  roots.push(root);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  return root;
}

const upgrade = (root: string, dryRun = false) =>
  runUpgrade({ root, from: "5.35.0", to: "5.36.0", codemods: [viteVitest], dryRun });

describe("codemod vite-8-vitest-5", () => {
  it("reads the lower bound of a range and keeps exact, caret and tilde styles", async () => {
    const root = app({
      "package.json": JSON.stringify({
        peerDependencies: { vite: ">=7.3.5 <8" },
        devDependencies: { vite: "~7.3.5", vitest: "^4.1.10", "@vitest/ui": "4.1.10" },
      }),
    });

    await upgrade(root);

    expect(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))).toEqual({
      peerDependencies: { vite: ">=7.3.5 <8" },
      devDependencies: { vite: "~8.3.3", vitest: "^5.0.3", "@vitest/ui": "5.0.3" },
    });
  });

  it("leaves versions that already allow the new majors, and non-registry specs, alone", async () => {
    const original = JSON.stringify({
      devDependencies: {
        vite: "^8.0.1",
        vitest: "workspace:*",
        "@vitejs/plugin-react": "file:../react",
      },
    });
    const root = app({ "package.json": original });

    const result = await upgrade(root);

    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(original);
    expect(result.applied).toEqual([]);
  });

  it("keeps an aliased runner import and its alias", async () => {
    const root = app({
      "package.json": "{}",
      "src/test-runner.ts":
        'import { VitestTestRunner as Base } from "vitest/runners";\nexport class Runner extends Base {}\n',
    });

    await upgrade(root);

    expect(readFileSync(path.join(root, "src/test-runner.ts"), "utf8")).toBe(
      'import { TestRunner as Base } from "vitest";\nexport class Runner extends Base {}\n',
    );
  });

  it("does not touch a runner that already calls the cleanup hook optionally", async () => {
    const source =
      'import { TestRunner } from "vitest";\nexport class Runner extends TestRunner {\n  public constructor(config: never) {\n    super(config);\n    this.onCleanupWorkerContext?.(() => undefined);\n  }\n}\n';
    const root = app({ "package.json": "{}", "src/test-runner.ts": source });

    const result = await upgrade(root);

    expect(readFileSync(path.join(root, "src/test-runner.ts"), "utf8")).toBe(source);
    expect(result.applied).toEqual([]);
  });

  it("writes nothing on a dry run", async () => {
    const original = JSON.stringify({ devDependencies: { vitest: "^4.1.10" } });
    const root = app({ "package.json": original });

    const result = await upgrade(root, true);

    expect(result.applied).toHaveLength(1);
    expect(readFileSync(path.join(root, "package.json"), "utf8")).toBe(original);
  });
});
