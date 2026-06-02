import { v } from "@warlock.js/seal";
import { Model } from "@warlock.js/cascade";
//#region ../../@warlock.js/core/src/http/database/RequestLog.ts
const schema = v.object({
	statusCode: v.number(),
	responseTime: v.number(),
	responseSize: v.number(),
	responseBody: v.record(v.any()),
	responseHeaders: v.record(v.any()),
	ip: v.string(),
	method: v.string(),
	route: v.string(),
	requestHeaders: v.record(v.any()),
	userAgent: v.string(),
	referer: v.string(),
	requestBody: v.record(v.any()),
	requestParams: v.record(v.any()),
	requestQuery: v.record(v.any())
});
var RequestLog = class extends Model {
	static {
		this.table = "request_logs";
	}
	static {
		this.schema = schema;
	}
};
//#endregion
export { RequestLog };

//# sourceMappingURL=RequestLog.mjs.map