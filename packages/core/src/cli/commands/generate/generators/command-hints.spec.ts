import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every generator that can't find a module tells the developer how to create
 * one. Those hints named `warlock create.module` / `warlock create.model` —
 * commands that DO NOT EXIST (the real ones are `generate.module` /
 * `generate.model`), so the single diagnostic meant to unblock the user sent
 * them to a "Command not found" (finding 2091d3ec). This guard fails if any
 * generator source suggests a `warlock create.*` command again.
 */
describe("generator command hints point at real commands (2091d3ec)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const generatorFiles = readdirSync(dir).filter(
    (file) => file.endsWith(".generator.ts"),
  );

  it("has generator source files to check", () => {
    expect(generatorFiles.length).toBeGreaterThan(0);
  });

  for (const file of generatorFiles) {
    it(`${file} suggests no non-existent 'warlock create.*' command`, () => {
      const source = readFileSync(path.join(dir, file), "utf-8");
      const suggestions = source.match(/warlock create\.[a-z]+/g) ?? [];
      expect(suggestions).toEqual([]);
    });
  }
});
