import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const template = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../templates/warlock/${file}`, import.meta.url)), "utf8");

describe("generated testing strategy", () => {
  it("pins a Vitest version with awaited worker cleanup support", () => {
    const manifest: { devDependencies: { vitest: string } } = JSON.parse(template("package.json"));
    expect(manifest.devDependencies.vitest).toBe("5.0.3");
  });
  it("documents matching project conventions and release commands", () => {
    const skill = template("skills/testing-strategy/SKILL.md");
    expect(skill).toContain('mode: "unit"');
    expect(skill).toContain('lifetime: "worker"');
    expect(skill).toContain("tests.resetBetweenFiles");
    expect(skill).toContain("--project integration");
    expect(skill).toContain('npx warlock test --changed --since "$LAST_RELEASE_REF"');
    expect(skill).not.toContain(".integration.spec.ts");
  });
});
