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

/** The content of a `SKILL.md`, or `undefined` when it is missing or unreadable. */
function readSkill(file: string): { file: string; content: string } | undefined {
  if (!existsSync(file)) return undefined;

  try {
    return { file, content: readFileSync(file, "utf8") };
  } catch {
    return undefined;
  }
}

/**
 * Every skill the installed `@warlock.js/*` packages ship, read from
 * `<cwd>/node_modules/@warlock.js/<package>/skills/<slug>/SKILL.md`, plus a
 * package's single `skills/SKILL.md` (slug: the front-matter `name`, else the
 * package name).
 * Sorted by package, then slug. Reads only the local install: no network.
 *
 * @param cwd The project root.
 */
export function listInstalledSkills(cwd: string): InstalledSkill[] {
  const scope = path.join(cwd, "node_modules", "@warlock.js");
  const skills: InstalledSkill[] = [];

  for (const packageFolder of directories(scope)) {
    const skillsRoot = path.join(scope, packageFolder, "skills");
    const packageName = `@warlock.js/${packageFolder}`;

    // A package that ships one skill puts it at `skills/SKILL.md`: its slug is
    // the front-matter `name`, else the package name.
    const single = readSkill(path.join(skillsRoot, "SKILL.md"));

    if (single) {
      const front = parseSkillFrontMatter(single.content);
      const slug = front.name ?? packageFolder;

      skills.push({
        package: packageName,
        slug,
        name: slug,
        description: front.description ?? "",
        file: path.relative(cwd, single.file).split(path.sep).join("/"),
      });
    }

    for (const slug of directories(skillsRoot)) {
      const skill = readSkill(path.join(skillsRoot, slug, "SKILL.md"));

      if (!skill) continue;

      const front = parseSkillFrontMatter(skill.content);

      skills.push({
        package: packageName,
        slug,
        name: front.name ?? slug,
        description: front.description ?? "",
        file: path.relative(cwd, skill.file).split(path.sep).join("/"),
      });
    }
  }

  return skills.sort(
    (a, b) => a.package.localeCompare(b.package) || a.slug.localeCompare(b.slug),
  );
}
