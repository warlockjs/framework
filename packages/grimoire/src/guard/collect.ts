/**
 * Gathering a {@link GuardInput}: the part of the guard that talks to git
 * and the file system. The rules themselves are in `rules.ts`.
 */
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GrimoireError } from "../codes";
import type { GuardFileText, GuardInput, TaskScope } from "../contracts/guard";
import { DEFAULT_GRIMOIRE_SETTINGS } from "../contracts/settings";
import type { GrimoireSnapshot } from "../contracts/snapshot";
import type { WrittenGrimoire } from "../contracts/written";
import { commitsIn, filesAt, showFile, type ChangedFile, type CommitInfo } from "../git";
import { parseGrimoire } from "../written";
import { readApiSnapshot, routeLines } from "./api";
import { matchesAny } from "./glob";
import { findTask, mergeScopes, readTaskScope } from "./scope";

/** Files Warlock writes and git ignores; they never count as changes (the snapshot is opened after `git` lists the change, but a project may lack the ignore lines). */
const GENERATED = [
  "grimoire/book/**",
  "grimoire/screenshots/captured/**",
  "grimoire/features/index.json",
  "grimoire/features/**/bookmap.json",
  "grimoire/features/**/*.bookmap.json",
  "grimoire/tasks/index.json",
];

const TEXT_FILE = /\.(?:[cm]?[jt]sx?|css|scss|less|json)$/;
const MAX_TEXT = 1024 * 1024;

/** The changes the guard looks at: git's list without the files Warlock generates. */
export function guardedChanges(changed: readonly ChangedFile[]): ChangedFile[] {
  return changed.filter((change) => !matchesAny(change.file, GENERATED));
}

async function readCurrent(root: string, file: string): Promise<string | null> {
  const absolute = path.join(root, ...file.split("/"));

  try {
    if ((await stat(absolute)).size > MAX_TEXT) return null;

    return await readFile(absolute, "utf8");
  } catch {
    return null;
  }
}

/** The text of every changed code, style and JSON file, now and at the base. */
export async function readTexts(
  root: string,
  base: string,
  changed: readonly ChangedFile[],
): Promise<Record<string, GuardFileText>> {
  const texts: Record<string, GuardFileText> = {};

  for (const change of changed) {
    if (!TEXT_FILE.test(change.file) && !(change.from !== null && TEXT_FILE.test(change.from)))
      continue;

    const before =
      change.status === "added" ? null : await showFile(root, base, change.from ?? change.file);

    texts[change.file] = {
      base: before !== null && before.length > MAX_TEXT ? null : before,
      current: change.status === "deleted" ? null : await readCurrent(root, change.file),
    };
  }

  return texts;
}

/** The written features at the base, parsed from a temporary copy; `null` when the change touches none. */
export async function readBaseWritten(
  root: string,
  base: string,
  changed: readonly ChangedFile[],
): Promise<WrittenGrimoire | null> {
  const touchesFeatures = changed.some((change) =>
    [change.file, change.from ?? ""].some((file) => file.startsWith("grimoire/features/")),
  );

  if (!touchesFeatures) return null;

  const folder = await mkdtemp(path.join(tmpdir(), "grimoire-guard-"));

  try {
    for (const file of await filesAt(root, base, "grimoire/features")) {
      if (!file.endsWith(".md")) continue;

      const text = await showFile(root, base, file);

      if (text === null) continue;

      const target = path.join(folder, ...file.split("/"));

      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, text);
    }

    return (await parseGrimoire(folder)).written;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** The task ids the commit messages name (`T-12`), in the order they appear. */
export function taskIdsIn(commits: readonly CommitInfo[]): string[] {
  const ids: string[] = [];

  for (const commit of commits) {
    for (const match of `${commit.subject}\n${commit.body}`.matchAll(/\bT-(\d+)\b/g)) {
      const id = `T-${Number(match[1])}`;

      if (!ids.includes(id)) ids.push(id);
    }
  }

  return ids;
}

/**
 * The task(s) the change is checked against: the argument, else the tasks
 * the commits name, else the one task `in progress`. `null` when none.
 * Throws `GR9008` when the argument names no task file.
 */
export function resolveScope(
  snapshot: GrimoireSnapshot,
  argument: string | undefined,
  commits: readonly CommitInfo[] | null,
): TaskScope | null {
  const { written } = snapshot;

  if (argument !== undefined && argument.trim() !== "") {
    const task = findTask(written, argument);

    if (task === null) {
      throw new GrimoireError(
        "GR9008",
        `${JSON.stringify(argument)} matches no task file under grimoire/tasks. Pass an id like T-12.`,
      );
    }

    return readTaskScope(task);
  }

  if (commits !== null) {
    const named = taskIdsIn(commits).flatMap((id) => {
      const task = findTask(written, id);

      return task === null ? [] : [task];
    });

    if (named.length > 0) return mergeScopes(named.map(readTaskScope));
  }

  const active = written.tasks.filter((task) => task.status.value === "in progress");

  return active.length === 1 && active[0] ? readTaskScope(active[0]) : null;
}

/** What the command was asked. */
export type GuardOptions = { task?: string; base: string; commits?: string };

/** Gather everything the rules read. `snapshot` is opened by the caller. */
export async function collectGuardInput(
  root: string,
  snapshot: GrimoireSnapshot,
  changed: readonly ChangedFile[],
  options: GuardOptions,
): Promise<GuardInput> {
  const commits = options.commits === undefined ? null : await commitsIn(root, options.commits);
  const flowFiles: Record<string, string[]> = {};

  for (const [ref, flow] of Object.entries(snapshot.collected.flows)) {
    flowFiles[ref] = [
      ...new Set(
        flow.steps.flatMap((step) => [...step.files, ...step.typeOnlyFiles, ...step.entries]),
      ),
    ];
  }

  const routes = snapshot.book.facts.routes;

  return {
    scope: resolveScope(snapshot, options.task, commits),
    changed: [...changed],
    texts: await readTexts(root, options.base, changed),
    ownership: snapshot.ownership,
    flowFiles,
    proofs: snapshot.proofs,
    baseWritten: await readBaseWritten(root, options.base, changed),
    written: snapshot.written,
    settings: snapshot.settings ?? DEFAULT_GRIMOIRE_SETTINGS,
    testFiles: snapshot.book.facts.tests,
    api: {
      approved: await readApiSnapshot(root),
      routes: routes === null ? null : routeLines(routes),
    },
    commits,
    taskIds: snapshot.written.tasks.map((task) => task.id.value),
  };
}
