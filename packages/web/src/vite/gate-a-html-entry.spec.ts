import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { gateAResolve } from "./gate-a-resolve";

const root = mkdtempSync(path.join(tmpdir(), "gate-a-html-entry-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

async function warningsFor(script: string): Promise<string[]> {
  const dir = mkdtempSync(path.join(root, "app-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>`,
  );
  writeFileSync(path.join(dir, "src", "main.ts"), script);

  const warnings: string[] = [];
  await build({
    root: dir,
    logLevel: "silent",
    plugins: [gateAResolve({ appRoot: dir })],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        onwarn: (warning) => {
          if (typeof warning.message === "string") warnings.push(warning.message);
        },
      },
    },
  });
  return warnings;
}

describe("gateAResolve — HTML entry", () => {
  it("does not report the app's index.html entry as an unjudged import", async () => {
    const warnings = await warningsFor(`export const answer = 42;\n`);

    expect(warnings.filter((message) => message.includes("Gate A"))).toEqual([]);
  });

  it("still warns about a genuinely unjudgeable import", async () => {
    const warnings = await warningsFor(`import { x } from "app/missing/thing";\nconsole.log(x);\n`);
    const judged = warnings.filter((message) => message.includes("could not judge"));

    expect(judged).toHaveLength(1);
    expect(judged[0]).toContain(`Specifier: "app/missing/thing"`);
  });
});
