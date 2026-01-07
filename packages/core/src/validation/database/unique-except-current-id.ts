import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { useRequestStore } from "../../http";
import type { UniqueExceptCurrentIdRuleOptions } from "../types";
/**
 * Unique except current ID rule
 */
export const uniqueExceptCurrentIdRule: SchemaRule<UniqueExceptCurrentIdRuleOptions> = {
  name: "uniqueExceptCurrentId",
  defaultErrorMessage: "The :input must be unique",
  async validate(value: any, context) {
    const {
      Model,
      column = context.key,
      exceptCurrentIdColumn = "id",
      query,
    } = this.context.options;

    const { request } = useRequestStore();

    const dbQuery = Model.query();

    dbQuery.where(column, value);
    dbQuery.where(exceptCurrentIdColumn, "!=", request.int("id"));

    if (query) {
      await query({
        query: dbQuery,
        value,
        allValues: context.allValues,
      });
    }

    const document = await dbQuery.first();
    return document ? invalidRule(this, context) : VALID_RULE;
  },
};
