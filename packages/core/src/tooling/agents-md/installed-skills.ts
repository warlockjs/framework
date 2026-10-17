import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** One `SKILL.md` an installed `@warlock.js/*` package ships. */
export type InstalledSkill = {
  /** The package, e.g. `@warlock.js/core`. */
  package: string;
  /** The skill folder name, e.g. `warlock-inspect`. */
  slug: string;
  /** The `name` from the front matter (the slug when absent). */
  name: string;
  /** The full `description` from the front matter (empty when absent). */
  description: string;
  /** Project-relative POSIX path of the `SKILL.md`. */
  file: string;
};

function directories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Read a front-matter scalar, unquoting YAML single/double-quoted values. */
function frontMatterValue(frontMatter: string, key: string): string | undefined {
  const match = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(frontMatter);
  const raw = match?.[1]?.trim();

  if (raw === undefined || raw.length === 0) return undefined;

  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }

  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1).replace(/\\"/g, '"');
  }

  return raw;
}

/** The `name` and `description` of a `SKILL.md`'s front matter. */
export function parseSkillFrontMatter(content: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);

  if (!match?.[1]) return {};

  return {
    name: frontMatterValue(match[1], "name"),
    description: frontMatterValue(match[1], "description"),
  };
}

/**
 * The first sentence of a skill description, capped at `max` characters —
 * the one line an agent reads to decide whether to open the skill.
 */
export function shortSkillLine(description: string, max = 120): string {
  const compact = description.replace(/\s+/g, " ").trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(compact)?.[1] ?? compact;

  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/**
 * Every skill the installed `@warlock.js/*` packages ship, read from
 * `<cwd>/node_modules/@warlock.js/<package>/skills/<slug>/SKILL.md`.
 * Sorted by package, then slug. Reads only the local install: no network.
 *
 * @param cwd The project root.
 */
export function listInstalledSkills(cwd: string): InstalledSkill[] {
  const scope = path.join(cwd, "node_modules", "@warlock.js");
  const skills: InstalledSkill[] = [];

  for (const packageFolder of directories(scope)) {
    const skillsRoot = path.join(scope, packageFolder, "skills");

    for (const slug of directories(skillsRoot)) {
      const file = path.join(skillsRoot, slug, "SKILL.md");

      if (!existsSync(file)) continue;

      let content: string;

      try {
        content = readFileSync(file, "utf8");
      } catch {
        continue;
      }

      const front = parseSkillFrontMatter(content);

      skills.push({
        package: `@warlock.js/${packageFolder}`,
        slug,
        name: front.name ?? slug,
        description: front.description ?? "",
        file: path.relative(cwd, file).split(path.sep).join("/"),
      });
    }
  }

  return skills;
}
