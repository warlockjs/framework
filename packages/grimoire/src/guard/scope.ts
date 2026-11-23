/**
 * Reading a task for the guard: which features, files, locked tests,
 * protected areas and removals its body allows.
 *
 * ```md
 * - Files: src/app/shared/utils/money.ts, src/config/catalog.ts
 * - Features: orders, catalog/wishlist
 * - Locked: src/app/catalog/tests/new-arrivals.test.ts
 * - Touches: migrations, dependencies
 * - Removes: catalog/new-arrivals AC-3, catalog/wishlist case duplicate
 * ```
 */
import type { RemoveEntry, TaskScope } from "../contracts/guard";
import type { WrittenGrimoire, WrittenTask } from "../contracts/written";
import { splitList } from "./glob";

const keyOf = (key: string): string => key.trim().replace(/\s+/g, " ").toLowerCase();

/** The numeric part of a task id (`T-12`, `12`, `T-012`), or `null`. */
export function taskNumber(text: string): number | null {
  const match = /^(?:T-)?0*(\d+)$/i.exec(text.trim());

  return match ? Number(match[1]) : null;
}

/** The task files that match `text` by number (`T-12`, `12`, `T-012`). */
export function findTask(written: WrittenGrimoire, text: string): WrittenTask | null {
  const wanted = taskNumber(text);

  if (wanted === null) return null;

  return written.tasks.find((task) => taskNumber(task.id.value) === wanted) ?? null;
}

/** One `Removes:` entry. Entries that do not read as `<feature>[/<flow>[ AC-n | case <question>]]` are kept as a feature name. */
export function parseRemoveEntry(text: string): RemoveEntry {
  const match = /^([a-z0-9][a-z0-9-]*)(?:\/([a-z0-9][a-z0-9-]*))?(?:\s+(?:(AC-\d+)|case\s+(.+)))?$/i.exec(
    text.trim(),
  );

  if (!match) return { feature: text.trim(), flow: null, criterion: null, case: null, text: text.trim() };

  return {
    feature: (match[1] ?? "").toLowerCase(),
    flow: match[2] === undefined ? null : match[2].toLowerCase(),
    criterion: match[3] === undefined ? null : match[3].toUpperCase(),
    case: match[4] === undefined ? null : match[4].trim().toLowerCase(),
    text: text.trim(),
  };
}

function fieldValues(task: WrittenTask, name: string): string[] {
  return task.fields
    .filter((field) => keyOf(field.key) === name)
    .flatMap((field) => splitList(field.value));
}

/** The flow ref a task names: `flow` is a flow id of `feature`, or a full `<feature>/<flow>`. */
function flowRefOf(task: WrittenTask): string | null {
  const value = task.flow?.value;

  if (value === undefined) return null;

  if (value.includes("/")) return value;

  return task.feature ? `${task.feature.value}/${value}` : null;
}

/** What one task allows. */
export function readTaskScope(task: WrittenTask): TaskScope {
  const feature = task.feature?.value ?? null;
  const flow = flowRefOf(task);
  const features = new Set<string>();

  if (feature !== null) features.add(feature);
  else if (flow !== null) features.add(flow.split("/")[0] ?? "");

  for (const entry of fieldValues(task, "features")) features.add(entry);

  return {
    id: task.id.value,
    file: task.file,
    feature: feature ?? (flow === null ? null : (flow.split("/")[0] ?? null)),
    flow,
    features: [...features],
    files: fieldValues(task, "files"),
    locked: fieldValues(task, "locked"),
    touches: fieldValues(task, "touches").map((name) => name.toLowerCase()),
    removes: fieldValues(task, "removes").map(parseRemoveEntry),
  };
}

/** Several tasks as one scope (the union of what each allows). */
export function mergeScopes(scopes: readonly TaskScope[]): TaskScope | null {
  const [first, ...rest] = scopes;

  if (first === undefined) return null;

  if (rest.length === 0) return first;

  const union = <T>(pick: (scope: TaskScope) => T[]): T[] => [...new Set(scopes.flatMap(pick))];

  return {
    id: scopes.map((scope) => scope.id).join(", "),
    file: first.file,
    feature: first.feature,
    flow: first.flow,
    features: union((scope) => scope.features),
    files: union((scope) => [...scope.files, scope.file]),
    locked: union((scope) => scope.locked),
    touches: union((scope) => scope.touches),
    removes: scopes.flatMap((scope) => scope.removes),
  };
}

/** The flow refs of a scope: its own flow and every `Features:` entry written as `<feature>/<flow>`. */
export function scopeFlows(scope: TaskScope): string[] {
  const flows = scope.features.filter((entry) => entry.includes("/"));

  if (scope.flow !== null) flows.push(scope.flow);

  return [...new Set(flows)];
}

/** The feature ids of a scope (a `<feature>/<flow>` entry gives its feature). */
export function scopeFeatures(scope: TaskScope): string[] {
  return [...new Set(scope.features.map((entry) => entry.split("/")[0] ?? entry))];
}
