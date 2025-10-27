import { Aggregate } from "@warlock.js/cascade";
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import type { ExistsRuleOptions } from "../types";

/**
 * Exists rule - validates record exists in database
 */
export const existsRule: SchemaRule<ExistsRuleOptions> = {
  name: "exists",
  defaultErrorMessage: "The :input must exist",
  async validate(value: any, context) {
    const { Model, query, column = context.key } = this.context.options;

    const dbQuery: Aggregate =
      typeof Model !== "string" ? Model.aggregate() : new Aggregate(Model);

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
