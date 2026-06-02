import { useRequestStore } from "../../http/context/request-context.mjs";
import "../../http/index.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
import { resolveModelClass } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/validation/database/exists-except-current-id.ts
/**
* Exists except current ID rule
*/
const existsExceptCurrentIdRule = {
	name: "existsExceptCurrentId",
	defaultErrorMessage: "The :input must exist",
	async validate(value, context) {
		const { Model, query, column = context.key, exceptCurrentIdColumn = "id" } = this.context.options;
		const { request } = useRequestStore();
		const dbQuery = resolveModelClass(Model).query();
		dbQuery.where(column, value);
		dbQuery.where(exceptCurrentIdColumn, "!=", request.int("id"));
		if (query) await query({
			query: dbQuery,
			value,
			allValues: context.allValues
		});
		return await dbQuery.first() ? VALID_RULE : invalidRule(this, context);
	}
};
//#endregion
export { existsExceptCurrentIdRule };

//# sourceMappingURL=exists-except-current-id.mjs.map