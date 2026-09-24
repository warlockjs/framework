import { DatabaseRemover } from "../../remover/database-remover";
import type { DeleteStrategy } from "../../types";
import type { RemoverResult } from "../../contracts";
import { sanitizeFilter } from "../../utils/sanitize-filter";
import type { ChildModel, Model } from "../model";

export async function destroyModel(
  model: Model,
  options?: { strategy?: DeleteStrategy; skipEvents?: boolean },
): Promise<RemoverResult> {
  const remover = new DatabaseRemover(model);
  return remover.destroy(options);
}

export async function deleteRecords(
  ModelClass: ChildModel<any>,
  filter?: Record<string, unknown>,
): Promise<number> {
  const sanitized = filter ? sanitizeFilter(filter) : undefined;

  if (!sanitized || Object.keys(sanitized).length === 0) {
    throw new Error(
      `${ModelClass.name}.delete() requires a filter: pass an explicit filter, or use ${ModelClass.name}.deleteAll() / ${ModelClass.name}.query().delete() to delete every row.`,
    );
  }

  // Through the query builder so global scopes (tenant, soft delete) apply.
  return ModelClass.query().where(sanitized).delete();
}

/** Delete every row visible to the model's global scopes. Explicit on purpose. */
export async function deleteAllRecords(ModelClass: ChildModel<any>): Promise<number> {
  return ModelClass.query().delete();
}

export async function deleteOneRecord(
  ModelClass: ChildModel<any>,
  filter?: Record<string, unknown>,
): Promise<number> {
  const query = ModelClass.query();

  if (filter && Object.keys(filter).length > 0) {
    query.where(sanitizeFilter(filter));
  }

  return query.deleteOne();
}
