import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function path(relative: string): string {
  return fileURLToPath(new URL(`../templates/warlock/${relative}`, import.meta.url));
}

function read(relative: string): string {
  return readFileSync(path(relative), "utf8");
}

describe("starter template: drift controls", () => {
  it("guards every pull request with full history and the base and commit range", () => {
    const workflow = read(".github/workflows/grimoire-guard.yml");

    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("npx warlock grimoire guard");
    expect(workflow).toContain('--base "$BASE" --commits "$BASE..HEAD"');
    expect(workflow).toContain("origin/${{ github.base_ref }}");

    for (const lockfile of ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"]) {
      expect(workflow).toContain(lockfile);
    }
  });

  it("runs the guard as a Stop hook that agent-kit does not own", () => {
    const settings = JSON.parse(read(".claude/settings.json")) as {
      hooks: { Stop: { hooks: { type: string; command: string }[] }[] };
    };

    expect(settings.hooks.Stop[0]?.hooks[0]).toEqual({
      type: "command",
      command: "npx warlock grimoire guard --hook",
    });
    // agent-kit writes CLAUDE.md and .claude/skills/ only.
    expect(existsSync(path(".claude/skills"))).toBe(false);
  });

  it("tells agents the guard, locked tests, protected areas, task ids and the code rules", () => {
    const agents = read("AGENTS.md");

    for (const text of [
      "grimoire guard",
      "Locked:",
      "Touches:",
      "T-12",
      "grimoire-allow",
      "approve api",
      "`.only`",
    ]) {
      expect(agents).toContain(text);
    }

    expect(agents).not.toContain("5.64 merge marker");
  });

  it("asks for a task id in every commit message", () => {
    const skill = read("skills/git-workflow/SKILL.md");

    expect(skill).toContain("Name the task");
    expect(skill).toContain("grimoire-guard");
  });
});
