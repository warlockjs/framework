import { environment } from "../../utils/environment.mjs";
import { requestContext, useRequestStore } from "../context/request-context.mjs";
import "../../utils/index.mjs";
import { BadRequestError, ForbiddenError, HttpError, ResourceNotFoundError, ServerError, UnAuthorizedError } from "../errors/errors.mjs";
import baseConfig from "@mongez/config";
import { trans } from "@mongez/localization";
import { DatabaseWriterValidationError } from "@warlock.js/cascade";
import { contextManager } from "@warlock.js/context";
//#region ../../@warlock.js/core/src/http/middleware/inject-request-context.ts
/**
* Request Context Middleware
*
* Creates a unified context for each request using the ContextManager.
* All framework contexts (request, storage, database) are available throughout the request lifecycle.
*/
/**
* Echo `request.id` back as a response header so the FE / proxies / log
* aggregators can correlate by the same value the server logs against.
*
* Reads the header name from `http.requestId.header` (default `X-Request-Id`).
* Skip when `http.requestId.enabled` is explicitly false.
*/
function stampRequestIdHeader(request, response) {
	const requestIdConfig = baseConfig.get("http.requestId", {});
	if (requestIdConfig.enabled === false) return;
	const headerName = requestIdConfig.header || "X-Request-Id";
	response.header(headerName, request.id);
}
/**
* Create request store and execute middleware + handler
*
* Runs all registered contexts together using ContextManager.
*/
function createRequestStore(request, response) {
	stampRequestIdHeader(request, response);
	const httpContextStore = contextManager.buildStores({
		request,
		response
	});
	return contextManager.runAll(httpContextStore, async () => {
		try {
			const result = await request.runMiddleware();
			if (result) return result;
			request.trigger("executingAction", request.route);
			const handler = request.getHandler();
			request.log("Executing Handler", "info");
			const output = await handler(request, response);
			request.log("Handler Executed Successfully", "success");
			request.trigger("executedAction", request.route);
			return output;
		} catch (error) {
			request.log(`${error.constructor.name}: Request failed: ${error.message}`, "error");
			return handleRequestError(error, response);
		}
	});
}
/**
* Handle request errors
* @internal
*/
function handleRequestError(error, response) {
	if (error instanceof HttpError) {
		const payload = { error: error.message };
		if (error.payload) payload.payload = error.payload;
		if (environment() === "development") payload.stack = error.stack;
		return response.setStatusCode(error.status).send(payload);
	}
	if (error instanceof ResourceNotFoundError) return response.notFound({
		error: error.message,
		...error.payload
	});
	if (error instanceof UnAuthorizedError) return response.unauthorized({
		error: error.message,
		...error.payload
	});
	if (error instanceof ForbiddenError) return response.forbidden({
		error: error.message,
		...error.payload
	});
	if (error instanceof BadRequestError) return response.badRequest({
		error: error.message,
		...error.payload
	});
	if (error instanceof DatabaseWriterValidationError) return response.badRequest({ errors: error.errors });
	if (error instanceof ServerError) return response.serverError({
		error: error.message,
		...error.payload
	});
	console.log(error);
	return response.badRequest({
		error: error.message,
		...error.payload
	});
}
/**
* Translate a keyword (uses request context for locale)
*/
function t(keyword, placeholders) {
	return requestContext.getRequest()?.trans(keyword, placeholders) || trans(keyword, placeholders);
}
/**
* Get or compute a value from the request cache
*
* If the value exists in request, return it.
* Otherwise, execute callback, store result in request, and return it.
*/
async function fromRequest(key, callback) {
	const { request } = useRequestStore();
	if (!request) return await callback();
	if (request[key]) return request[key];
	request[key] = await callback(request);
	return request[key];
}
//#endregion
export { createRequestStore, fromRequest, t };

//# sourceMappingURL=inject-request-context.mjs.map