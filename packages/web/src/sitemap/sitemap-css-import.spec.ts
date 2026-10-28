import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const coreSource = path.join(repositoryRoot, "packages/core/src");
const webSource = path.join(repositoryRoot, "packages/web/src");
// Run node with the tsx loader: the `.bin/tsx` shim is a `.cmd` file on Windows and cannot be
// spawned directly.
const tsxLoader = pathToFileURL(
  createRequire(path.join(repositoryRoot, "package.json")).resolve("tsx"),
).href;

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) {
    fs.rmSync(directories.pop() as string, { recursive: true, force: true });
  }
});

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf-8");
}

/**
 * Sitemap discovery imports page modules in plain Node, through the ESM loader
 * hook the dev server registers. Vitest would hide a stylesheet import problem
 * (Vite handles CSS), so this runs the real thing in a child process.
 */
function discoverInNode(appRoot: string): Promise<{ code: number | null; output: string }> {
  const script = path.join(appRoot, "discover.mts");

  write(
    appRoot,
    "discover.mts",
    `
    process.chdir(${JSON.stringify(appRoot)});
    const { filesOrchestrator } = await import(${JSON.stringify(pathToFileURL(path.join(coreSource, "dev-server/files-orchestrator.ts")).href)});
    const { warlockConfigManager } = await import(${JSON.stringify(pathToFileURL(path.join(coreSource, "warlock-config/warlock-config.manager.ts")).href)});
    await warlockConfigManager.load();
    await filesOrchestrator.init();
    const { listRoutablePages } = await import(${JSON.stringify(pathToFileURL(path.join(webSource, "build/list-routable-pages.ts")).href)});
    const pages = await listRoutablePages({ appRoot: ${JSON.stringify(appRoot)} });
    console.log("PAGES:" + JSON.stringify(pages.map((page) => [page.routePath, typeof page.sitemap])));
    process.exit(0);
    `,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, script], {
      cwd: appRoot,
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);

    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

describe("sitemap discovery with stylesheet imports", () => {
  it("lists a page whose component imports a stylesheet", async () => {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "warlock-sitemap-css-"));
    directories.push(appRoot);

    write(appRoot, "package.json", JSON.stringify({ name: "sitemap-css-app", type: "module" }));
    write(appRoot, "warlock.config.ts", "export default {};\n");
    write(appRoot, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022" } }));
    write(appRoot, "src/web/components/card.css", ".card { color: red; }\n");
    write(appRoot, "src/web/components/card.module.css", ".box { color: blue; }\n");
    write(
      appRoot,
      "src/web/components/card.ts",
      [
        'import "./card.css";',
        'import styles from "./card.module.css";',
        "export const Card = () => styles;",
      ].join("\n"),
    );
    write(
      appRoot,
      "src/web/home.page.tsx",
      [
        'import { Card } from "./components/card";',
        'export const config = { route: "/", sitemap: async () => [{ path: "/" }] };',
        "export default function Page() { return Card(); }",
      ].join("\n"),
    );

    const { code, output } = await discoverInNode(appRoot);

    expect(output).toContain('PAGES:[["/","function"]]');
    expect(code).toBe(0);
  }, 120_000);
});
