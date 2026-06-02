import { get } from "@mongez/reinforcements";
import { invalidRule, VALID_RULE, type SchemaRule } from "@warlock.js/seal";
import { resolveModelClass } from "../../model/register-model";
import type { UniqueRuleOptions } from "../types";

/**
 * Validates that a value is unique against a database column.
 *
 * Supports three exclusion modes:
 * - `except`: read a sibling input's value and exclude rows where that
 *   column equals the sibling's value
 * - `exceptColumnName` + `exceptValue`: exclude rows where the named
 *   column equals the supplied value (used by request-aware wrappers)
 * - Custom `query` callback for anything more involved
 *
 * @example
 * v.email().unique("User");
 * v.string().unique("User", { except: "id" });
 */
export const uniqueRule: SchemaRule<UniqueRuleOptions> = {
  name: "unique",
  defaultErrorMessage: "The :input must be unique",
  async validate(value: any, context) {
    const {
      Model,
      except,
      column = context.key,
      exceptColumnName,
      exceptValue,
      query,
    } = this.context.options;

    const ResolvedModelClass = resolveModelClass(Model);

    const dbQuery = ResolvedModelClass.query();

    dbQuery.where(column, value);

    if (except) {
      const exceptVal = get(context.allValues, except);

      if (exceptVal !== undefined) {
        dbQuery.where(except, "!=", exceptVal);
      }
    }

    if (exceptColumnName !== undefined) {
      dbQuery.where(exceptColumnName, "!=", exceptValue);
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
