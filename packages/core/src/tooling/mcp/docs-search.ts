import fg from "fast-glob";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Offline search over the documentation the app has INSTALLED: every
 * `@warlock.js/*` package's skills (`skills/**\/*.md`), `README.md` and
 * `llms.txt` / `llms-full.txt`. Nothing is fetched, so the answers match the
 * versions in `node_modules`, not whatever the website documents today.
 */

/** The globs, relative to the project root, that make up the corpus. */
export const DOCS_CORPUS_GLOBS = [
  "node_modules/@warlock.js/*/skills/**/*.md",
  "node_modules/@warlock.js/*/README.md",
  "node_modules/@warlock.js/*/llms.txt",
  "node_modules/@warlock.js/*/llms-full.txt",
] as const;

/** One searchable section: a file split at its markdown headings. */
export type DocsSection = {
  /** `@warlock.js/<name>`. */
  package: string;
  /** Project-relative POSIX path of the file. */
  file: string;
  /** `skill`, `readme` or `llms`. */
  source: "skill" | "readme" | "llms";
  /** The section heading, or the file name for text before the first heading. */
  heading: string;
  /** 1-based line where the section starts. */
  line: number;
  text: string;
};

/** One search hit. */
export type DocsSearchHit = {
  package: string;
  file: string;
  source: DocsSection["source"];
  heading: string;
  line: number;
  score: number;
  /** The section's lines around the first match, bounded. */
  excerpt: string;
};

/** The loaded corpus. */
export type DocsCorpus = {
  files: string[];
  sections: DocsSection[];
};

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const MAX_EXCERPT = 1200;

function sourceOf(file: string): DocsSection["source"] {
  if (file.includes("/skills/")) return "skill";

  return path.basename(file).toLowerCase() === "readme.md" ? "readme" : "llms";
}

function packageOf(file: string): string {
  const match = /node_modules\/(@warlock\.js\/[^/]+)\//.exec(file);

  return match?.[1] ?? "@warlock.js";
}

/** Split markdown text into heading-delimited sections. */
export function splitSections(
  text: string,
  meta: { package: string; file: string; source: DocsSection["source"] },
): DocsSection[] {
  const sections: DocsSection[] = [];
  const lines = text.split(/\r?\n/);
  let heading = path.basename(meta.file);
  let start = 1;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buffer.join("\n").trim();

    if (body.length > 0) sections.push({ ...meta, heading, line: start, text: body });
  };

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("```")) inFence = !inFence;

    const match = inFence ? null : HEADING.exec(line);

    if (match?.[2]) {
      flush();
      heading = match[2];
      start = index + 1;
      buffer = [line];
      return;
    }

    buffer.push(line);
  });

  flush();

  return sections;
}

/** Load the corpus of the app at `cwd`. Unreadable files are skipped. */
export async function loadDocsCorpus(cwd: string): Promise<DocsCorpus> {
  const files = (
    await fg([...DOCS_CORPUS_GLOBS], { cwd, onlyFiles: true, followSymbolicLinks: true })
  ).sort();
  const sections: DocsSection[] = [];

  for (const file of files) {
    let text: string;

    try {
      text = readFileSync(path.join(cwd, file), "utf8");
    } catch {
      continue;
    }

    sections.push(
      ...splitSections(text, { package: packageOf(file), file, source: sourceOf(file) }),
    );
  }

  return { files, sections };
}

/** Lower-cased search terms of two or more characters. */
export function searchTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9_.@/-]+/)
        .map((term) => term.replace(/^[.\-/]+|[.\-/]+$/g, ""))
        .filter((term) => term.length >= 2),
    ),
  ];
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);

  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }

  return count;
}

function excerptOf(section: DocsSection, terms: readonly string[]): string {
  const lines = section.text.split("\n");
  const first = Math.max(
    0,
    lines.findIndex((line) => terms.some((term) => line.toLowerCase().includes(term))),
  );
  const from = Math.max(0, first - 3);
  const excerpt = lines.slice(from, from + 18).join("\n");

  return excerpt.length > MAX_EXCERPT ? `${excerpt.slice(0, MAX_EXCERPT)}…` : excerpt;
}

/**
 * Rank sections for a query: every term found in the heading counts 5, in the
 * body 1 per occurrence (capped), and each distinct term found adds 10, so a
 * section matching all terms beats one repeating a single term. Skills rank
 * above READMEs above llms files on equal scores; the generated `llms-full.txt`
 * repeats the skills, so it is weighted down.
 */
export function searchDocs(
  corpus: DocsCorpus,
  query: string,
  options: { limit?: number; package?: string } = {},
): DocsSearchHit[] {
  const terms = searchTerms(query);

  if (terms.length === 0) return [];

  const limit = options.limit ?? 8;
  const sourceRank: Record<DocsSection["source"], number> = { skill: 0, readme: 1, llms: 2 };
  const hits: DocsSearchHit[] = [];

  for (const section of corpus.sections) {
    if (options.package && section.package !== options.package) continue;

    const heading = section.heading.toLowerCase();
    const body = section.text.toLowerCase();
    let score = 0;
    let matched = 0;

    for (const term of terms) {
      const inHeading = heading.includes(term);
      const inBody = Math.min(occurrences(body, term), 10);

      if (inHeading || inBody > 0) matched++;

      score += (inHeading ? 5 : 0) + inBody;
    }

    if (matched === 0) continue;

    score += matched * 10;

    if (section.file.endsWith("llms-full.txt")) score = Math.floor(score / 2);

    hits.push({
      package: section.package,
      file: section.file,
      source: section.source,
      heading: section.heading,
      line: section.line,
      score,
      excerpt: excerptOf(section, terms),
    });
  }

  return hits
    .sort(
      (first, second) =>
        second.score - first.score ||
        sourceRank[first.source] - sourceRank[second.source] ||
        first.file.localeCompare(second.file) ||
        first.line - second.line,
    )
    .slice(0, limit);
}

/**
 * Read one corpus file (optionally one section of it). Only files of the
 * corpus can be read, so the tool never becomes a general file reader.
 *
 * @returns `undefined` when `file` is not in the corpus.
 */
export function readDocsFile(
  corpus: DocsCorpus,
  cwd: string,
  file: string,
  options: { heading?: string; maxBytes?: number } = {},
): { file: string; heading: string | null; text: string; truncated: boolean } | undefined {
  const normalized = file.split(path.sep).join("/").replace(/^\.\//, "");

  if (!corpus.files.includes(normalized)) return undefined;

  let text: string;

  if (options.heading) {
    const wanted = options.heading.toLowerCase();
    const section = corpus.sections.find(
      (candidate) => candidate.file === normalized && candidate.heading.toLowerCase() === wanted,
    );

    if (!section) return undefined;

    text = section.text;
  } else {
    text = readFileSync(path.join(cwd, normalized), "utf8");
  }

  const maxBytes = options.maxBytes ?? 100_000;
  const truncated = text.length > maxBytes;

  return {
    file: normalized,
    heading: options.heading ?? null,
    text: truncated ? text.slice(0, maxBytes) : text,
    truncated,
  };
}
