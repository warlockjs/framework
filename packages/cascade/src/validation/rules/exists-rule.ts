import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { resolveModelClass } from "../../model/register-model";
import type { ExistsRuleOptions } from "../types";

/**
 * Validates that a record exists in the database for the given column/value.
 *
 * @example
 * v.string().exists(Organization, { column: "id" });
 */
export const existsRule: SchemaRule<ExistsRuleOptions> = {
  name: "exists",
  defaultErrorMessage: "The :input must exist",
  async validate(value: any, context) {
    const { Model, query, column = context.key } = this.context.options;

    const ResolvedModelClass = resolveModelClass(Model);

    const dbQuery = ResolvedModelClass.query();

    dbQuery.where(column, value);

    if (query) {
      await query({
        query: dbQuery,
        value,
        allValues: context.allValues,
      });
    }

    const document = await dbQuery.first();

    return document ? VALID_RULE : invalidRule(this, context);
  },
};
