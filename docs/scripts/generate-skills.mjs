import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Catalog the package front door, never list grouped topics as exported skills. */
export function collectPackageSkills(packagesRoot) {
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const root = path.join(packagesRoot, entry.name);
      const manifestPath = path.join(root, "package.json");
      if (!existsSync(manifestPath)) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.private) return [];
      const skillsRoot = path.join(root, "skills");
      const rootSkill = path.join(skillsRoot, "SKILL.md");
      const source = existsSync(rootSkill) ? "skills/SKILL.md" : "skills/index.md";
      const file = path.join(root, source);
      if (!existsSync(file)) throw new Error(`Missing package skill: ${manifest.name}`);
      const frontmatter = readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const scalar = frontmatter?.[1]?.match(/^description:[ \t]*(.*)$/m)?.[1]?.trim();
      // Package descriptions use quoted single-line YAML; decode escaped quotes.
      const description = scalar?.startsWith('"')
        ? JSON.parse(scalar)
        : scalar?.startsWith("'")
          ? scalar.slice(1, -1).replace(/''/g, "'")
          : scalar;
      if (typeof description !== "string" || !description.trim() || description.length > 450) {
        throw new Error(`Invalid package skill description: ${manifest.name}`);
      }
      const slug = manifest.name.replace(/^@/, "").replace(/[/.]/g, "-").toLowerCase();
      return [
        {
          package: manifest.name,
          slug,
          source: `packages/${entry.name}/${source}`,
          description,
          characters: description.length,
        },
      ];
    });
}

export function generateSkills(workspaceRoot) {
  const skills = collectPackageSkills(path.join(workspaceRoot, "packages"));
  const totalCharacters = skills.reduce((total, skill) => total + skill.characters, 0);
  if (totalCharacters >= 14_000)
    throw new Error(`Package skill descriptions total ${totalCharacters}; must stay under 14000`);
  writeFileSync(
    path.join(workspaceRoot, "docs/src/data/skills.json"),
    `${JSON.stringify({ totalCharacters, skills }, null, 2)}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  generateSkills(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."));
}
