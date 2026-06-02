import { useCurrentUser } from "../../http/context/request-context.mjs";
import "../../http/index.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
import { resolveModelClass } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/validation/database/exists-except-current-user.ts
/**
* Exists except current user rule
*/
const existsExceptCurrentUserRule = {
	name: "existsExceptCurrentUser",
	defaultErrorMessage: "The :input must exist",
	async validate(value, context) {
		const { Model, query, column = context.key, exceptCurrentUserColumn = "id", exceptCurrentUserValue = "id" } = this.context.options;
		const user = useCurrentUser();
		const dbQuery = resolveModelClass(Model).query();
		dbQuery.where(column, value);
		if (user) dbQuery.where(exceptCurrentUserColumn, "!=", user.get(exceptCurrentUserValue));
		if (query) await query({
			query: dbQuery,
			value,
			allValues: context.allValues
		});
		return await dbQuery.first() ? VALID_RULE : invalidRule(this, context);
	}
};
//#endregion
export { existsExceptCurrentUserRule };

//# sourceMappingURL=exists-except-current-user.mjs.map