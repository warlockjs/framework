import type { ObjectValidator } from "@warlock.js/seal";

/** The static side of a model class, as far as the guard needs it. */
type GuardedModelClass = { schema?: ObjectValidator; name: string; prototype: object };

/**
 * Dev-time guard for `model.<column>` reads.
 *
 * Model data lives in `model.data` and is read with `model.get("column")`, so
 * `model.title` is always `undefined`. In development (anything but
 * `NODE_ENV=production`) each schema column that does not collide with a member
 * of the model gets a prototype accessor that logs one warning per model and
 * column, naming the fix. Assigning through the accessor still works: it
 * defines a plain own property, exactly what a plain assignment did before.
 *
 * In production nothing is installed and the constructor pays one boolean test.
 */
export const columnReadGuardEnabled = process.env.NODE_ENV !== "production";

const guardedModels = new WeakSet<object>();
const warnedColumns = new Set<string>();

function warnColumnRead(modelName: string, column: string): void {
  const id = `${modelName}.${column}`;

  if (warnedColumns.has(id)) return;
  warnedColumns.add(id);

  console.warn(
    `[cascade] \`${modelName}.${column}\` reads a column as a property, which is always undefined. ` +
      `Read it with \`model.get("${column}")\` and write it with \`model.set("${column}", value)\`.`,
  );
}

/**
 * Install the property-read guard for the schema columns of `ModelClass`.
 * Runs once per model class; a no-op in production.
 */
export function guardColumnPropertyReads(ModelClass: GuardedModelClass): void {
  if (!columnReadGuardEnabled || guardedModels.has(ModelClass)) return;
  guardedModels.add(ModelClass);

  const shape = ModelClass.schema?.schema;

  if (!shape) return;

  const prototype = ModelClass.prototype;
  const modelName = ModelClass.name;

  for (const column of Object.keys(shape)) {
    // Members of the model (`id`, methods, custom getters) are real properties.
    if (column in prototype) continue;

    Object.defineProperty(prototype, column, {
      configurable: true,
      enumerable: false,
      get() {
        warnColumnRead(modelName, column);

        return undefined;
      },
      set(this: object, value: unknown) {
        Object.defineProperty(this, column, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      },
    });
  }
}

/** Forget which columns already warned. For specs. */
export function resetColumnReadWarnings(): void {
  warnedColumns.clear();
}
