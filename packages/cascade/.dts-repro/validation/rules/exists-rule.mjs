import { resolveModelClass } from "../../model/register-model.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
//#region ../../@warlock.js/cascade/src/validation/rules/exists-rule.ts
/**
* Validates that a record exists in the database for the given column/value.
*
* @example
* v.string().exists(Organization, { column: "id" });
*/
const existsRule = {
	name: "exists",
	defaultErrorMessage: "The :input must exist",
	async validate(value, context) {
		const { Model, query, column = context.key } = this.context.options;
		const dbQuery = resolveModelClass(Model).query();
		dbQuery.where(column, value);
		if (query) await query({
			query: dbQuery,
			value,
			allValues: context.allValues
		});
		return await dbQuery.first() ? VALID_RULE : invalidRule(this, context);
	}
};
//#endregion
export { existsRule };

//# sourceMappingURL=exists-rule.mjs.map