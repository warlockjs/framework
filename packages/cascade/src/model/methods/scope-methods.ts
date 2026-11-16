import type { QueryBuilderContract } from "../../contracts";
import type { GlobalScopeOptions, LocalScopeCallback, ChildModel, Model } from "../model";

/**
 * Give the model class its OWN scope map before mutating.
 *
 * The `globalScopes` / `localScopes` statics live on the base `Model`; without
 * this, `ModelClass.globalScopes.set(...)` from any subclass mutates the ONE
 * inherited Map and the scope leaks onto every other model (a soft-delete
 * `notDeleted` scope registered on `User` would filter `Post` too). The own
 * map snapshots the currently-inherited entries so parent scopes registered so
 * far are kept.
 */
function ownScopeMap(
  ModelClass: ChildModel<any>,
  property: "globalScopes" | "localScopes",
): Map<string, any> {
  if (!Object.prototype.hasOwnProperty.call(ModelClass, property)) {
    (ModelClass as any)[property] = new Map((ModelClass as any)[property]);
  }

  return (ModelClass as any)[property];
}

export function addGlobalModelScope(
  ModelClass: ChildModel<any>,
  name: string,
  callback: (query: QueryBuilderContract) => void,
  options: GlobalScopeOptions = {},
): void {
  ownScopeMap(ModelClass, "globalScopes").set(name, {
    callback,
    timing: options.timing || "before",
    stamp: options.stamp,
  });
}

export function removeGlobalModelScope(ModelClass: ChildModel<any>, name: string): void {
  ownScopeMap(ModelClass, "globalScopes").delete(name);
}

export function addLocalModelScope(
  ModelClass: ChildModel<any>,
  name: string,
  callback: LocalScopeCallback,
): void {
  ownScopeMap(ModelClass, "localScopes").set(name, callback);
}

export function removeLocalModelScope(ModelClass: ChildModel<any>, name: string): void {
  ownScopeMap(ModelClass, "localScopes").delete(name);
}

/**
 * The column values the model's global scopes stamp into inserts. A scope
 * registered on the subclass wins over the base `Model` for the same column.
 */
export function collectScopeStamp(ModelClass: ChildModel<any>): Record<string, unknown> {
  const stamp: Record<string, unknown> = {};

  const scopes = [...rootGlobalScopes(ModelClass), ...ModelClass.globalScopes.values()];

  for (const scope of scopes) {
    if (!scope.stamp) continue;

    const values = typeof scope.stamp === "function" ? scope.stamp() : scope.stamp;

    for (const [column, value] of Object.entries(values ?? {})) {
      if (value !== undefined) {
        stamp[column] = value;
      }
    }
  }

  return stamp;
}

/** Global scopes registered on the base `Model` (the root of the class chain). */
function rootGlobalScopes(ModelClass: ChildModel<any>) {
  let root: any = ModelClass;

  while (Object.getPrototypeOf(root) && Object.getPrototypeOf(root) !== Function.prototype) {
    root = Object.getPrototypeOf(root);
  }

  return root === ModelClass ? [] : [...(root.globalScopes as Map<string, any>).values()];
}

/**
 * Fill the stamped columns of a NEW record that the caller left unset.
 * Returns the columns it wrote.
 */
export function applyScopeStamp(model: Model): string[] {
  const stamp = collectScopeStamp(model.self());
  const written: string[] = [];

  for (const [column, value] of Object.entries(stamp)) {
    if (!model.isFilled(column)) {
      model.set(column, value);
      written.push(column);
    }
  }

  return written;
}
