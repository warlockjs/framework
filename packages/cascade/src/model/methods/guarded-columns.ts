import type { ChildModel } from "../model";

/**
 * Objects the framework knows carry a request's raw input (for example the
 * result of `request.all()`), so `merge()` can warn in development when they
 * are written to a model without validation.
 */
const rawInputObjects = new WeakSet<object>();

/** Model classes (and column names) already warned about, so each warns once. */
const warnedGuardedColumns = new Map<ChildModel<any>, Set<string>>();
const warnedRawInputModels = new WeakSet<ChildModel<any>>();

/**
 * Mark an object as raw, unvalidated request input.
 *
 * `merge()` and `set()` on a model warn once (outside production) when they
 * receive a marked object, pointing at the validated input instead. The HTTP
 * layer marks the objects it returns for the raw request body; apps can mark
 * their own.
 */
export function markRawInput<TInput extends object>(input: TInput): TInput {
  rawInputObjects.add(input);

  return input;
}

/** Whether `input` was marked with {@link markRawInput}. */
export function isRawInput(input: unknown): boolean {
  return typeof input === "object" && input !== null && rawInputObjects.has(input);
}

/** Whether `key` is a guarded column or a dot path inside one. */
function isGuardedKey(guarded: readonly string[], key: string): boolean {
  return guarded.some((column) => key === column || key.startsWith(`${column}.`));
}

/**
 * Drop the model class's `guarded` columns from a mass-assignment payload.
 *
 * Returns `values` untouched (same reference) when nothing is guarded or
 * nothing in the payload matches. Dropped columns are reported once per model
 * and column outside production, so the skipped write is not a silent surprise.
 */
export function stripGuardedColumns(
  ModelClass: ChildModel<any>,
  values: Record<string, unknown>,
  caller: string,
): Record<string, unknown> {
  const guarded = ModelClass.guarded;

  if (!guarded || guarded.length === 0) {
    return values;
  }

  const blocked = Object.keys(values).filter((key) => isGuardedKey(guarded, key));

  if (blocked.length === 0) {
    return values;
  }

  // Copy: the caller's object (often the request body) is not ours to mutate.
  const safeValues = { ...values };

  for (const key of blocked) {
    delete safeValues[key];
  }

  warnGuardedColumns(ModelClass, blocked, caller);

  return safeValues;
}

function warnGuardedColumns(ModelClass: ChildModel<any>, blocked: string[], caller: string): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  let warned = warnedGuardedColumns.get(ModelClass);

  if (!warned) {
    warned = new Set();
    warnedGuardedColumns.set(ModelClass, warned);
  }

  const fresh = blocked.filter((key) => !warned.has(key));

  if (fresh.length === 0) {
    return;
  }

  for (const key of fresh) {
    warned.add(key);
  }

  console.warn(
    `[cascade] ${ModelClass.name}.${caller}() skipped guarded column(s) ${fresh
      .map((key) => `"${key}"`)
      .join(", ")}. Write them on purpose with forceMerge() / forceCreate().`,
  );
}

/**
 * Warn (outside production, once per model) when raw request input is merged
 * into a model that declares no guarded columns.
 */
export function warnRawInputMerge(ModelClass: ChildModel<any>, values: unknown): void {
  if (process.env.NODE_ENV === "production" || !isRawInput(values)) {
    return;
  }

  if (warnedRawInputModels.has(ModelClass)) {
    return;
  }

  warnedRawInputModels.add(ModelClass);

  console.warn(
    `[cascade] ${ModelClass.name}.merge() received the request's raw input. ` +
      `Merge validated input (request.validated()) or list the columns a request must never write in \`static guarded\`.`,
  );
}
