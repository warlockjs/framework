/**
 * Names every emitted JavaScript chunk after its FINAL bytes.
 *
 * The bundler hashes a chunk before the import specifiers inside it are
 * rewritten to the final names of the chunks they point at. Two builds that
 * differ only in the name of an imported chunk therefore emitted the same
 * `name-<hash>.js` for different bytes, and two byte-identical chunks could
 * keep two different names. Immutable caching assumes a name always means the
 * same bytes, so this pass runs on the build output once the bundler is done:
 *
 * 1. each chunk's references to other chunks are found by their file names;
 * 2. chunks are named in dependency order, so a chunk's name hashes its code
 *    with every referenced chunk already carrying its final name;
 * 3. chunks that reference each other (a cycle) share one digest of their
 *    canonical code, and every member's name derives from it;
 * 4. a non-entry chunk whose final code equals an earlier chunk's code is not
 *    written: its importers are pointed at the earlier chunk;
 * 5. the client manifest and the budget module report are rewritten to the
 *    same names, before anything downstream (budgets, preloads, precompressed
 *    siblings) reads them.
 *
 * Pure file-system work on the output directory: no bundler API is involved.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, rm, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** A JavaScript chunk the bundler emitted. */
export type EmittedChunk = {
  /** Output path relative to the output directory, POSIX separators: `assets/page-AbC123xY.js`. */
  readonly fileName: string;
  /** Entry chunks keep their own file; they are renamed but never merged into another chunk. */
  readonly isEntry: boolean;
};

export type FinalizedChunkNames = {
  /** Every chunk's old file name to its final file name (deduplicated chunks map to the kept chunk). */
  readonly renamed: ReadonlyMap<string, string>;
  /** Old file names of chunks that were byte-identical to another chunk and not written. */
  readonly deduplicated: ReadonlyMap<string, string>;
};

const SELF_PLACEHOLDER = "__WARLOCK_CHUNK_SELF__";
const MEMBER_PLACEHOLDER = "__WARLOCK_CHUNK_MEMBER__";
const HASH_LENGTH = 8;
const MANIFEST_FILE = ".vite/manifest.json";
const BUDGET_MODULES_FILE = ".vite/budget-modules.json";

type ChunkState = {
  readonly index: number;
  readonly fileName: string;
  readonly directory: string;
  readonly oldBase: string;
  readonly stem: string;
  readonly isEntry: boolean;
  readonly code: string;
  references: number[];
  newBase?: string;
  /** The kept chunk's index, when this chunk is a byte-identical duplicate. */
  duplicateOf?: number;
};

function digest(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function shortHash(value: string): string {
  return digest(value).slice(0, HASH_LENGTH);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A single-pass replacer: names are matched whole, so one replacement never feeds the next. */
function createReplacer(names: ReadonlyMap<string, string>): (text: string) => string {
  if (names.size === 0) return (text) => text;

  const alternatives = [...names.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  const pattern = new RegExp(`(?<![A-Za-z0-9.-])(?:${alternatives})(?![A-Za-z0-9-])`, "g");

  return (text) => text.replace(pattern, (match) => names.get(match) ?? match);
}

function stemOf(base: string): string {
  const match = /^(.*)-[A-Za-z0-9_-]{8}\.js$/.exec(base);
  return match?.[1] ?? base.replace(/\.js$/, "");
}

/** Strongly connected components, dependencies first. */
function stronglyConnected(chunks: readonly ChunkState[]): number[][] {
  const order = new Array<number>(chunks.length).fill(-1);
  const low = new Array<number>(chunks.length).fill(0);
  const onStack = new Array<boolean>(chunks.length).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;

  const visit = (node: number): void => {
    order[node] = counter;
    low[node] = counter;
    counter += 1;
    stack.push(node);
    onStack[node] = true;

    for (const next of chunks[node]?.references ?? []) {
      if (order[next] === -1) {
        visit(next);
        low[node] = Math.min(low[node] as number, low[next] as number);
      } else if (onStack[next]) {
        low[node] = Math.min(low[node] as number, order[next] as number);
      }
    }

    if (low[node] === order[node]) {
      const component: number[] = [];
      let member: number | undefined;

      do {
        member = stack.pop() as number;
        onStack[member] = false;
        component.push(member);
      } while (member !== node);

      components.push(component);
    }
  };

  for (let node = 0; node < chunks.length; node += 1) {
    if (order[node] === -1) visit(node);
  }

  return components;
}

/** Rewrites the keys and string values of a JSON document, de-duplicating import lists. */
function rewriteJson(value: unknown, replace: (text: string) => string, key?: string): unknown {
  if (typeof value === "string") return replace(value);

  if (Array.isArray(value)) {
    const mapped = value.map((item) => rewriteJson(item, replace));
    return key === "imports" || key === "dynamicImports" ? [...new Set(mapped)] : mapped;
  }

  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};

    for (const [name, child] of Object.entries(value)) {
      const renamed = replace(name);
      const rewritten = rewriteJson(child, replace, name);

      if (Object.hasOwn(result, renamed)) {
        // Deduplicated chunks collapse onto one key. Their lists (the modules
        // each held) are merged so no module is lost from the report.
        const existing = result[renamed];

        if (Array.isArray(existing) && Array.isArray(rewritten)) {
          const seen = new Set(existing.map((item) => JSON.stringify(item)));
          result[renamed] = [
            ...existing,
            ...rewritten.filter((item) => !seen.has(JSON.stringify(item))),
          ];
        }

        continue;
      }

      result[renamed] = rewritten;
    }

    return result;
  }

  return value;
}

async function rewriteJsonFile(file: string, replace: (text: string) => string): Promise<void> {
  if (!existsSync(file)) return;

  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify(rewriteJson(parsed, replace)), "utf8");
}

/**
 * Renames the chunks in `outDir` after their final bytes and rewrites the
 * manifest and the budget module report to match. See the file header.
 */
export async function finalizeChunkNames(input: {
  readonly outDir: string;
  readonly chunks: readonly EmittedChunk[];
}): Promise<FinalizedChunkNames> {
  const states: ChunkState[] = [];

  // Sorted, so which of two identical chunks is kept never depends on emit order.
  const ordered = [...input.chunks].sort((a, b) => a.fileName.localeCompare(b.fileName));

  for (const chunk of ordered) {
    const posix = chunk.fileName.split(path.sep).join("/");
    const oldBase = path.posix.basename(posix);

    states.push({
      index: states.length,
      fileName: posix,
      directory: path.posix.dirname(posix),
      oldBase,
      stem: stemOf(oldBase),
      isEntry: chunk.isEntry,
      code: await readFile(path.join(input.outDir, posix), "utf8"),
      references: [],
    });
  }

  const renamed = new Map<string, string>();
  const deduplicated = new Map<string, string>();

  if (states.length === 0) return { renamed, deduplicated };

  // Which chunks does each chunk's code name? Any occurrence of a file name
  // counts: static imports, dynamic imports and the preload dependency lists.
  const indexByBase = new Map(states.map((state) => [state.oldBase, state.index]));
  const finder = new RegExp(
    `(?<![A-Za-z0-9.-])(?:${[...indexByBase.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
      .join("|")})(?![A-Za-z0-9-])`,
    "g",
  );

  for (const state of states) {
    const found = new Set<number>();

    for (const match of state.code.matchAll(finder)) {
      const target = indexByBase.get(match[0]);
      if (target !== undefined && target !== state.index) found.add(target);
    }

    state.references = [...found];
  }

  /** Maps resolved chunks (and a chosen self name) to their final base names. */
  const resolvedNames = (selfOldBase: string, selfName: string): Map<string, string> => {
    const names = new Map<string, string>([[selfOldBase, selfName]]);

    for (const state of states) {
      if (state.newBase === undefined) continue;
      names.set(state.oldBase, state.newBase);
    }

    return names;
  };

  const keptByCode = new Map<string, number>();

  for (const component of stronglyConnected(states)) {
    const members = component.map((index) => states[index] as ChunkState);

    if (members.length === 1) {
      const state = members[0] as ChunkState;
      const hashed = createReplacer(resolvedNames(state.oldBase, SELF_PLACEHOLDER))(state.code);
      const key = digest(hashed);
      const kept = state.isEntry ? undefined : keptByCode.get(key);

      if (kept !== undefined) {
        state.duplicateOf = kept;
        state.newBase = (states[kept] as ChunkState).newBase;
        continue;
      }

      state.newBase = `${state.stem}-${key.slice(0, HASH_LENGTH)}.js`;
      if (!state.isEntry) keptByCode.set(key, state.index);
      continue;
    }

    // A cycle: names cannot depend on each other, so every member hashes its
    // own code with the in-cycle names blanked, together with the digest of
    // the whole cycle. Any change inside the cycle renames all of it.
    const inCycle = new Map<string, string>(
      members.map((member) => [member.oldBase, MEMBER_PLACEHOLDER]),
    );
    const canonical = members.map((member) => {
      const external = new Map<string, string>();
      for (const other of states) {
        if (other.newBase !== undefined && !inCycle.has(other.oldBase)) {
          external.set(other.oldBase, other.newBase);
        }
      }

      return { member, code: createReplacer(new Map([...external, ...inCycle]))(member.code) };
    });
    const cycleDigest = digest(
      canonical
        .map((entry) => digest(entry.code))
        .sort()
        .join("|"),
    );

    for (const entry of canonical) {
      entry.member.newBase = `${entry.member.stem}-${shortHash(`${cycleDigest}:${entry.code}`)}.js`;
    }
  }

  const finalNames = new Map<string, string>();

  for (const state of states) {
    finalNames.set(state.oldBase, state.newBase as string);
    renamed.set(state.fileName, `${state.directory}/${state.newBase}`);

    if (state.duplicateOf !== undefined) {
      deduplicated.set(state.fileName, renamed.get(state.fileName) as string);
    }
  }

  const rewrite = createReplacer(finalNames);

  // Write the new files first, then remove the old ones that no new name reuses.
  const written = new Set<string>();

  for (const state of states) {
    if (state.duplicateOf !== undefined) continue;

    const target = `${state.directory}/${state.newBase}`;
    written.add(target);

    await writeFile(path.join(input.outDir, target), rewrite(state.code), "utf8");

    const mapFile = path.join(input.outDir, `${state.fileName}.map`);
    if (existsSync(mapFile) && target !== state.fileName) {
      const renamedMap = path.join(input.outDir, `${target}.map`);
      await rename(mapFile, renamedMap);
      await renameSourceMapFile(renamedMap, path.basename(target));
    }
  }

  for (const state of states) {
    if (written.has(state.fileName)) continue;

    await rm(path.join(input.outDir, state.fileName), { force: true });
    await rm(path.join(input.outDir, `${state.fileName}.map`), { force: true });
  }

  await rewriteJsonFile(path.join(input.outDir, MANIFEST_FILE), rewrite);
  await rewriteJsonFile(path.join(input.outDir, BUDGET_MODULES_FILE), rewrite);

  return { renamed, deduplicated };
}

/**
 * A renamed chunk's source map still names the old file in its `file` field;
 * point it at the new name. A map that is not valid JSON is left as it is.
 */
async function renameSourceMapFile(mapPath: string, fileName: string): Promise<void> {
  try {
    const map = JSON.parse(await readFile(mapPath, "utf8")) as { file?: unknown };

    if (typeof map.file !== "string" || map.file === fileName) return;

    map.file = fileName;
    await writeFile(mapPath, JSON.stringify(map), "utf8");
  } catch {
    // Not JSON: nothing to rewrite.
  }
}
