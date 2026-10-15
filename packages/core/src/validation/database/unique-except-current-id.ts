import { resolveModelClass } from "@warlock.js/cascade";
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
      param = "id",
    } = this.context.options as UniqueExceptCurrentIdRuleOptions & { param?: string };

    const { request } = useRequestStore();

    const ResolvedModelClass = resolveModelClass(Model);

    const dbQuery = ResolvedModelClass.query();

    dbQuery.where(column, value);
    // Read the current id from the configured route param, keeping ObjectId/UUID strings intact
    const rawId = request.input(param);

    if (rawId !== undefined && rawId !== null && rawId !== "") {
      const currentId =
        typeof rawId === "string" && /^\d{1,15}$/.test(rawId) ? Number(rawId) : rawId;

      dbQuery.where(exceptCurrentIdColumn, "!=", currentId);
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
