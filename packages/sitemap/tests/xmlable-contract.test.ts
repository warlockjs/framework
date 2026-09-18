import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Sitemap } from "../src/sitemap";

type XMLable = {
  toXML(): string;
};

const baseUrl = "https://example.com";

describe("Sitemap — XMLable contract", () => {
  it("structurally satisfies { toXML(): string } without importing the contract", () => {
    const sitemap: XMLable = new Sitemap({ baseUrl }).add({ path: "/" });

    const xml = sitemap.toXML();

    expect(typeof xml).toBe("string");
    expect(xml.startsWith("<?xml")).toBe(true);
  });
});

/**
 * The package's whole value is being usable from a bare Express app or a
 * cron script. If any file under `src` reached into `@warlock.js/core`,
 * that claim would be false for everyone who doesn't run Warlock.
 */
describe("Sitemap package — framework-blindness", () => {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const srcDir = join(packageRoot, "src");

  function listSourceFiles(dir: string): string[] {
    const files: string[] = [];

    for (const name of readdirSync(dir)) {
      const fullPath = join(dir, name);

      if (statSync(fullPath).isDirectory()) {
        files.push(...listSourceFiles(fullPath));
        continue;
      }

      if (!name.endsWith(".ts") || name.endsWith(".spec.ts")) continue;

      files.push(fullPath);
    }

    return files;
  }

  it("imports no @warlock.js/core module from any non-spec source file", () => {
    const offenders = listSourceFiles(srcDir).filter((filePath) =>
      readFileSync(filePath, "utf8").includes("@warlock.js/core"),
    );

    expect(offenders).toEqual([]);
  });

  it("declares no @warlock.js/core dependency in package.json", () => {
    const packageJsonPath = join(packageRoot, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("@warlock.js/core");
    expect(Object.keys(packageJson.peerDependencies ?? {})).not.toContain("@warlock.js/core");
    expect(Object.keys(packageJson.devDependencies ?? {})).not.toContain("@warlock.js/core");
  });
});
