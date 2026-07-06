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
