/**
 * Skill cross-reference and grouped-layout gate.
 *
 * ## Why this exists
 *
 * An app's `postinstall` runs `agent-kit sync`, which copies every installed
 * package's skills into `.claude/skills/warlock-js-<pkg>/` and FLATTENS them:
 * `skills/<topic>/SKILL.md` becomes `<topic>.md`. A skill that points at
 * another one by path (`../send-response/SKILL.md`,
 * `@warlock.js/web/create-a-page/SKILL.md`, `../../../cache/skills/x/SKILL.md`)
 * therefore points at nothing inside the app, and the agent reading it is
 * sent to node_modules instead. The 2026-10-01 skills audit found ~900 such
 * references across six packages.
 *
 * The convention is to name the topic: "the `send-response` topic", and across
 * packages "the `pick-cache-driver` topic of the `warlock-js-cache` skill".
 * This gate fails, naming file and line, on any `<something>/SKILL.md` path
 * inside a package's `skills/**\/*.md`. The bare word `SKILL.md` (as in "each
 * folder holds one `SKILL.md`") is not a path and is not flagged.
 * Grouped indexes must also name every local topic, never name a missing local
 * topic, and keep grouped guidance in topic folders rather than loose files.
 * Single-topic packages use a root SKILL.md; every package exports one skill
 * with a nonempty package description of at most 450 characters (700 for a grouped index).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** The monorepo root (tools/release/scripts -> ../../..). */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
/** Every shipped package is a direct child of this directory. */
export const PACKAGES_ROOT = path.join(REPO_ROOT, "packages");

export type SkillPathRef = {
  /** Workspace-relative, posix-separated. */
  relPath: string;
  /** 1-based. */
  line: number;
  /** The matched path. */
  ref: string;
};

/** A path segment followed by `/SKILL.md`: `../x/SKILL.md`, `x/SKILL.md`, `@warlock.js/web/x/SKILL.md`. */
const PATH_REF_RE = /[\w.@-]+\/SKILL\.md/g;

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function walkMarkdown(dir: string, repoRoot: string, into: string[]): void {
  for (const name of readdirSync(dir)) {
    const child = path.join(dir, name);

    if (isDirectory(child)) {
      walkMarkdown(child, repoRoot, into);
    } else if (name.endsWith(".md")) {
      into.push(child);
    }
  }
}

/** Every `skills/**\/*.md` one directory below the workspace root. */
export function discoverSkillFiles(repoRoot: string): string[] {
  const files: string[] = [];

  for (const dir of readdirSync(repoRoot)) {
    if (dir === "node_modules" || dir.startsWith(".")) continue;

    const skillsRoot = path.join(repoRoot, dir, "skills");

    if (isDirectory(skillsRoot) && isDirectory(path.join(repoRoot, dir))) {
      walkMarkdown(skillsRoot, repoRoot, files);
    }
  }

  return files.sort();
}

/** Pure matcher over one file's text. */
export function findSkillPathRefs(relPath: string, text: string): SkillPathRef[] {
  const refs: SkillPathRef[] = [];
  const lines = text.split(/\r\n|\n/);

  for (let index = 0; index < lines.length; index++) {
    for (const match of (lines[index] ?? "").matchAll(PATH_REF_RE)) {
      refs.push({ relPath, line: index + 1, ref: match[0] });
    }
  }

  return refs;
}

export function runSkillPathRefsGate(repoRoot: string): SkillPathRef[] {
  return discoverSkillFiles(repoRoot).flatMap((file) =>
    findSkillPathRefs(toPosix(path.relative(repoRoot, file)), readFileSync(file, "utf8")),
  );
}

export type SkillLayoutIssue = {
  package: string;
  relPath: string;
  line: number;
  topic: string;
  type:
    | "loose-markdown"
    | "unknown-topic"
    | "unlisted-topic"
    | "invalid-layout"
    | "missing-description"
    | "description-too-long";
  message: string;
};

/** Keep offsets intact while excluding metadata and explicitly owned foreign topics. */
function localIndexBody(text: string, packageDir: string): string {
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (meta) => meta.replace(/[^\r\n]/g, " "))
    .replace(
      /(?:the\s+)?`[a-z][a-z0-9-]*(?:\.md)?`\s+topic\s+of\s+(?:the\s+)?`(@warlock\.js\/[a-z0-9-]+|warlock-js-[a-z0-9-]+)`\s+(?:package|skill)/g,
      (ref, owner: string) =>
        owner === `@warlock.js/${packageDir}` || owner === `warlock-js-${packageDir}`
          ? ref
          : ref.replace(/[^\r\n]/g, " "),
    )
    .replace(/`warlock-js-[a-z0-9-]+`/g, (owner) => " ".repeat(owner.length));
}

/**
 * Index orientation uses topic filenames, backticked hyphenated slugs, explicit
 * `slug` topic references, or comma-separated slug lists. Plain API identifiers
 * and package specifiers are not topic references.
 */
export function findIndexTopicRefs(text: string): { topic: string; line: number }[] {
  const refs: { topic: string; line: number }[] = [];

  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const topics = new Set<string>();
    const patterns = [
      /\b([a-z][a-z0-9-]*)\.md\b/g,
      /`(overview|[a-z][a-z0-9]*(?:-[a-z0-9]+)+)`/g,
      /`([a-z][a-z0-9-]*)` topic\b/g,
      /\btopic `([a-z][a-z0-9-]*)`/g,
    ];

    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        if (match[1]) topics.add(match[1]);
      }
    }

    // Support the compact, unquoted area lists used by the core index.
    const list = line.match(
      /^\s*[-*] (?:\*\*[^*]+:\*\* )?([a-z][a-z0-9-]*(?:, [a-z][a-z0-9-]*)*)\s*$/,
    );
    for (const topic of list?.[1]?.split(", ") ?? []) topics.add(topic);

    for (const topic of topics) refs.push({ topic, line: index + 1 });
  }

  return refs;
}

/** `repoRoot` is the packages directory, also used by fixture-based specs. */
export function runSkillLayoutGate(repoRoot: string): SkillLayoutIssue[] {
  const issues: SkillLayoutIssue[] = [];

  for (const packageDir of readdirSync(repoRoot).sort()) {
    if (packageDir.startsWith(".") || packageDir === "node_modules") continue;
    const skillsRoot = path.join(repoRoot, packageDir, "skills");
    if (!isDirectory(skillsRoot)) continue;
    const names = readdirSync(skillsRoot).sort();
    const topics = new Set(
      names.filter(
        (name) =>
          isDirectory(path.join(skillsRoot, name)) &&
          statIsFile(path.join(skillsRoot, name, "SKILL.md")),
      ),
    );
    const addIssue = (
      file: string,
      line: number,
      topic: string,
      type: SkillLayoutIssue["type"],
      message: string,
    ) => {
      issues.push({
        package: packageDir === "create-warlock" ? packageDir : `@warlock.js/${packageDir}`,
        relPath: toPosix(path.relative(repoRoot, path.join(skillsRoot, file))),
        line,
        topic,
        type,
        message,
      });
    };

    const rootSkill = statIsFile(path.join(skillsRoot, "SKILL.md"));
    const indexFile = path.join(skillsRoot, "index.md");
    if (rootSkill && (topics.size > 0 || statIsFile(indexFile))) {
      addIssue(
        "SKILL.md",
        1,
        "",
        "invalid-layout",
        "root SKILL.md cannot be mixed with topic skills or index.md",
      );
    }

    for (const name of names) {
      // Root-layout skills export their sibling reference assets too.
      if (rootSkill) continue;
      if (name !== "index.md" && name.endsWith(".md") && statIsFile(path.join(skillsRoot, name))) {
        addIssue(
          name,
          1,
          name.slice(0, -3),
          "loose-markdown",
          "loose Markdown is not exported; move agent guidance into <topic>/SKILL.md or merge orientation into index.md",
        );
      }
    }

    if (!statIsFile(indexFile)) continue;
    const refs = findIndexTopicRefs(localIndexBody(readFileSync(indexFile, "utf8"), packageDir));
    const mentioned = new Set(refs.map((ref) => ref.topic));

    for (const ref of refs) {
      if (!topics.has(ref.topic)) {
        addIssue(
          "index.md",
          ref.line,
          ref.topic,
          "unknown-topic",
          "index names a local topic without a matching <topic>/SKILL.md; qualify topics owned by another package",
        );
      }
    }
    for (const topic of topics) {
      if (!mentioned.has(topic)) {
        addIssue(
          "index.md",
          1,
          topic,
          "unlisted-topic",
          "topic is missing from the index body; add it to the orientation",
        );
      }
    }
  }

  return issues;
}

/** Decode the simple YAML scalars used in package skill frontmatter. */
export function readSkillDescription(text: string): string | undefined {
  const frontmatter = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const field = frontmatter?.[1]?.match(/^description:[ \t]*(.*)$/m);
  if (!field) return undefined;
  const value = (field[1] ?? "").trim();
  if (value.startsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);
      return typeof decoded === "string" ? decoded.trim() : undefined;
    } catch {
      return undefined;
    }
  }
  if (value.startsWith("'")) {
    return value.endsWith("'") ? value.slice(1, -1).replace(/''/g, "'").trim() : undefined;
  }
  // Fail closed on YAML block scalars/collections instead of counting only a marker.
  // Authors use a quoted, single-line description so every consumer sees the same text.
  if (/^(?:[>|{}&*!]|\[|\])/.test(value) || /^(?:null|~|true|false|\d+)$/i.test(value))
    return undefined;
  return value.replace(/\s+#.*$/, "").trim();
}

/** One package skill under agent-kit's default auto layout, with a bounded description. */
export function runSkillPackageGate(repoRoot: string): SkillLayoutIssue[] {
  const issues: SkillLayoutIssue[] = [];
  for (const packageDir of readdirSync(repoRoot).sort()) {
    if (packageDir.startsWith(".") || packageDir === "node_modules") continue;
    const skillsRoot = path.join(repoRoot, packageDir, "skills");
    const manifestFile = path.join(repoRoot, packageDir, "package.json");
    if (!isDirectory(skillsRoot) && !statIsFile(manifestFile)) continue;
    if (statIsFile(manifestFile)) {
      const manifest: { private?: boolean } = JSON.parse(readFileSync(manifestFile, "utf8"));
      if (manifest.private) continue;
    }
    const files: string[] = [];
    if (isDirectory(skillsRoot)) walkMarkdown(skillsRoot, repoRoot, files);
    const skills = files.filter((file) => path.basename(file) === "SKILL.md");
    const rootFile = path.join(skillsRoot, "SKILL.md");
    const indexFile = path.join(skillsRoot, "index.md");
    const rootSkill = statIsFile(rootFile);
    const hasIndex = statIsFile(indexFile);
    const validRoot = rootSkill && skills.length === 1 && !hasIndex;
    const validGrouped =
      !rootSkill &&
      hasIndex &&
      skills.length >= 2 &&
      skills.every((file) => path.dirname(path.dirname(file)) === skillsRoot);
    const frontDoor = rootSkill ? rootFile : hasIndex ? indexFile : (skills[0] ?? rootFile);
    const addIssue = (type: SkillLayoutIssue["type"], message: string) => {
      issues.push({
        package: packageDir === "create-warlock" ? packageDir : `@warlock.js/${packageDir}`,
        relPath: toPosix(path.relative(repoRoot, frontDoor)),
        line: 1,
        topic: "",
        type,
        message,
      });
    };
    if (!validRoot && !validGrouped) {
      addIssue(
        "invalid-layout",
        "ship exactly one package skill: skills/SKILL.md alone, or skills/index.md with at least two direct topic folders; nested or unindexed topic skills are not allowed",
      );
    }
    const description = statIsFile(frontDoor)
      ? readSkillDescription(readFileSync(frontDoor, "utf8"))
      : undefined;
    if (!description) {
      addIssue(
        "missing-description",
        "package skill requires a nonempty single-line frontmatter description",
      );
    } else if (description.length > (hasIndex ? 700 : 450)) {
      addIssue(
        "description-too-long",
        `package skill description has ${description.length} characters; maximum is ${hasIndex ? 700 : 450}`,
      );
    }
  }
  return issues;
}

function statIsFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const refs = runSkillPathRefsGate(PACKAGES_ROOT);
  const layoutIssues = [
    ...runSkillLayoutGate(PACKAGES_ROOT),
    ...runSkillPackageGate(PACKAGES_ROOT),
  ];

  if (refs.length > 0) {
    for (const ref of refs) {
      console.error(`${ref.relPath}:${ref.line}  ${ref.ref}`);
    }

    console.error(
      `\nskill-path-refs: ${refs.length} path-style reference(s). agent-kit flattens skills on install, so ` +
        'refer by topic name instead: "the `x` topic" or "the `x` topic of the `warlock-js-<pkg>` skill".',
    );
    process.exitCode = 1;
  }

  for (const issue of layoutIssues) {
    console.error(
      `${issue.package} ${issue.relPath}:${issue.line} [${issue.topic}] ${issue.message}`,
    );
  }
  if (layoutIssues.length > 0) {
    console.error(`skill-path-refs: ${layoutIssues.length} package skill issue(s).`);
    process.exitCode = 1;
  }
  if (refs.length === 0 && layoutIssues.length === 0) {
    console.log(
      "skill-path-refs: one skill per package, descriptions and topic references are consistent",
    );
  }
}
