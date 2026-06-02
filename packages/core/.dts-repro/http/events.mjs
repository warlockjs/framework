import { RequestLog } from "./database/RequestLog.mjs";
//#region ../../@warlock.js/core/src/http/events.ts
function logResponse(response) {
	const request = response.request;
	RequestLog.create({
		statusCode: response.statusCode,
		responseTime: response.getResponseTime(),
		responseSize: response.getHeader("Content-Length"),
		responseBody: response.body,
		responseHeaders: response.getHeaders(),
		ip: request.ip,
		method: request.route.method,
		route: request.route.path,
		requestHeaders: request.headers,
		userAgent: request.userAgent,
		referer: request.referer,
		requestParams: request.params,
		requestQuery: request.query
	});
}
function wrapResponseInDataKey(response) {
	if (typeof response.body === "string") return;
	if (response.body) response.body = { data: response.body };
}
//#endregion
export { logResponse, wrapResponseInDataKey };

//# sourceMappingURL=events.mjs.map