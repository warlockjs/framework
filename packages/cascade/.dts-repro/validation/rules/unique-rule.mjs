import { resolveModelClass } from "../../model/register-model.mjs";
import { get } from "@mongez/reinforcements";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/rules/unique-rule.ts
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
const uniqueRule = {
	name: "unique",
	defaultErrorMessage: "The :input must be unique",
	async validate(value, context) {
		const { Model, except, column = context.key, exceptColumnName, exceptValue, query } = this.context.options;
		const dbQuery = resolveModelClass(Model).query();
		dbQuery.where(column, value);
		if (except) {
			const exceptVal = get(context.allValues, except);
			if (exceptVal !== void 0) dbQuery.where(except, "!=", exceptVal);
		}
		if (exceptColumnName !== void 0) dbQuery.where(exceptColumnName, "!=", exceptValue);
		if (query) await query({
			query: dbQuery,
			value,
			allValues: context.allValues
		});
		return await dbQuery.first() ? invalidRule(this, context) : VALID_RULE;
	}
};
//#endregion
export { uniqueRule };

//# sourceMappingURL=unique-rule.mjs.map