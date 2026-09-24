import { resolveModelClass } from "@warlock.js/cascade";
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { useRequestStore } from "../../http";
import type { ExistsExceptCurrentIdRuleOptions } from "../types";

/**
 * Exists except current ID rule
 */
export const existsExceptCurrentIdRule: SchemaRule<ExistsExceptCurrentIdRuleOptions> = {
  name: "existsExceptCurrentId",
  defaultErrorMessage: "The :input must exist",
  async validate(value: any, context) {
    const {
      Model,
      query,
      column = context.key,
      exceptCurrentIdColumn = "id",
      param = "id",
    } = this.context.options as ExistsExceptCurrentIdRuleOptions & { param?: string };

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
    return document ? VALID_RULE : invalidRule(this, context);
  },
};
