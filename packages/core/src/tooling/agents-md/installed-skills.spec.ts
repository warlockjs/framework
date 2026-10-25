import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listInstalledSkills } from "./installed-skills";

describe("listInstalledSkills", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "warlock-skills-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function skill(packageFolder: string, relative: string, content: string) {
    const file = path.join(cwd, "node_modules", "@warlock.js", packageFolder, "skills", relative);

    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  it("reads skills/<slug>/SKILL.md", () => {
    skill(
      "core",
      "warlock-doctor/SKILL.md",
      "---\nname: warlock-doctor\ndescription: Run the doctor.\n---\n",
    );

    expect(listInstalledSkills(cwd)).toEqual([
      {
        package: "@warlock.js/core",
        slug: "warlock-doctor",
        name: "warlock-doctor",
        description: "Run the doctor.",
        file: "node_modules/@warlock.js/core/skills/warlock-doctor/SKILL.md",
      },
    ]);
  });

  it("reads a package's single skills/SKILL.md and slugs it from the front-matter name", () => {
    skill(
      "ai-anthropic",
      "SKILL.md",
      "---\nname: setup-anthropic\ndescription: Wire Anthropic.\n---\n",
    );

    expect(listInstalledSkills(cwd)).toEqual([
      {
        package: "@warlock.js/ai-anthropic",
        slug: "setup-anthropic",
        name: "setup-anthropic",
        description: "Wire Anthropic.",
        file: "node_modules/@warlock.js/ai-anthropic/skills/SKILL.md",
      },
    ]);
  });

  it("falls back to the package name when the single skill has no name", () => {
    skill("sitemap", "SKILL.md", "---\ndescription: Generate a sitemap.\n---\n");
    skill("ai-openai", "SKILL.md", "no front matter at all");

    const skills = listInstalledSkills(cwd);

    expect(skills.map((entry) => [entry.package, entry.slug])).toEqual([
      ["@warlock.js/ai-openai", "ai-openai"],
      ["@warlock.js/sitemap", "sitemap"],
    ]);
  });

  it("lists a single skill together with folder skills, sorted by package then slug", () => {
    skill("core", "b-skill/SKILL.md", "---\nname: b-skill\n---\n");
    skill("core", "a-skill/SKILL.md", "---\nname: a-skill\n---\n");
    skill("core", "SKILL.md", "---\nname: core-overview\n---\n");

    expect(listInstalledSkills(cwd).map((entry) => entry.slug)).toEqual([
      "a-skill",
      "b-skill",
      "core-overview",
    ]);
  });

  it("returns nothing when no package ships skills", () => {
    mkdirSync(path.join(cwd, "node_modules", "@warlock.js", "seal"), { recursive: true });

    expect(listInstalledSkills(cwd)).toEqual([]);
  });
});
