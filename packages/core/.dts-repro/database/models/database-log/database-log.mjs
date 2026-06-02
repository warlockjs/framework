import { v } from "@warlock.js/seal";
import { Model } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/database/models/database-log/database-log.ts
const schema = v.object({
	module: v.string(),
	action: v.string(),
	message: v.string(),
	trace: v.record(v.any()),
	level: v.string()
});
var DatabaseLogModel = class extends Model {
	static {
		this.table = "logs";
	}
	static {
		this.schema = schema;
	}
};
//#endregion
export { DatabaseLogModel };

//# sourceMappingURL=database-log.mjs.map