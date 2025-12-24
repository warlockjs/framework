import { Aggregate } from "@warlock.js/cascade";
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { useRequestStore } from "../../http";
import type { UniqueExceptCurrentUserRuleOptions } from "../types";

/**
 * Unique except current user rule
 */
export const uniqueExceptCurrentUserRule: SchemaRule<UniqueExceptCurrentUserRuleOptions> =
  {
    name: "uniqueExceptCurrentUser",
    defaultErrorMessage: "The :input must be unique",
    async validate(value: any, context) {
      const {
        Model,
        column = context.key,
        exceptCurrentUserColumn = "id",
        exceptCurrentUserValue = "id",
        query,
      } = this.context.options;

      const { user } = useRequestStore();

      const dbQuery: Aggregate =
        typeof Model !== "string" ? Model.aggregate() : new Aggregate(Model);

      dbQuery.where(column, value);

      if (user) {
        dbQuery.where(
          exceptCurrentUserColumn,
          "!=",
          user.get(exceptCurrentUserValue),
        );
      }

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
