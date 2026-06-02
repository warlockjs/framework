import { useCurrentUser } from "../../http/context/request-context.mjs";
import "../../http/index.mjs";
import { VALID_RULE, invalidRule } from "@warlock.js/seal";
import { resolveModelClass } from "@warlock.js/cascade";
import { get } from "@mongez/reinforcements";
//#region ../../@warlock.js/core/src/validation/database/unique-except-current-user.ts
/**
* Unique except current user rule
*/
const uniqueExceptCurrentUserRule = {
	name: "uniqueExceptCurrentUser",
	defaultErrorMessage: "The :input must be unique",
	async validate(value, context) {
		const { Model, column = context.key, exceptCurrentUserColumn = "id", exceptCurrentUserValue = "id", query } = this.context.options;
		const user = useCurrentUser();
		const ResolvedModelClass = resolveModelClass(Model);
		const dbQuery = ResolvedModelClass.query();
		dbQuery.where(column, value);
		if (user) {
			const value = user instanceof ResolvedModelClass ? user.get(exceptCurrentUserValue) : get(user, exceptCurrentUserValue);
			dbQuery.where(exceptCurrentUserColumn, "!=", value);
		}
		if (query) await query({
			query: dbQuery,
			value,
			allValues: context.allValues
		});
		return await dbQuery.first() ? invalidRule(this, context) : VALID_RULE;
	}
};
//#endregion
export { uniqueExceptCurrentUserRule };

//# sourceMappingURL=unique-except-current-user.mjs.map