import { useRequestStore } from "../../http/context/request-context.mjs";
import "../../http/index.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
import { resolveModelClass } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/validation/database/unique-except-current-id.ts
/**
* Unique except current ID rule
*/
const uniqueExceptCurrentIdRule = {
	name: "uniqueExceptCurrentId",
	defaultErrorMessage: "The :input must be unique",
	async validate(value, context) {
		const { Model, column = context.key, exceptCurrentIdColumn = "id", query } = this.context.options;
		const { request } = useRequestStore();
		const dbQuery = resolveModelClass(Model).query();
		dbQuery.where(column, value);
		dbQuery.where(exceptCurrentIdColumn, "!=", request.input("id"));
		if (query) await query({
			query: dbQuery,
			value,
			allValues: context.allValues
		});
		return await dbQuery.first() ? invalidRule(this, context) : VALID_RULE;
	}
};
//#endregion
export { uniqueExceptCurrentIdRule };

//# sourceMappingURL=unique-except-current-id.mjs.map