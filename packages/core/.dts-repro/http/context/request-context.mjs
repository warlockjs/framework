import { Context, contextManager } from "@warlock.js/context";
//#region ../../@warlock.js/core/src/http/context/request-context.ts
/**
* Request Context
*
* Manages request-scoped data (request, response, user) using AsyncLocalStorage.
* Extends the base Context class for consistent API.
*/
var RequestContext = class extends Context {
	/**
	* Get the current request
	*/
	getRequest() {
		return this.get("request");
	}
	/**
	* Get the current response
	*/
	getResponse() {
		return this.get("response");
	}
	/**
	* Get the current user
	*/
	getUser() {
		return this.getRequest()?.user;
	}
	/**
	* Build the initial request store from HTTP context
	*/
	buildStore(payload) {
		return {
			request: payload?.request,
			response: payload?.response
		};
	}
};
/**
* Global request context instance
*/
const requestContext = new RequestContext();
contextManager.register("request", requestContext);
/**
* Use request store (for backward compatibility)
*/
function useRequestStore() {
	return requestContext.getStore() || {};
}
function useRequest() {
	return requestContext.getRequest();
}
function useCurrentUser() {
	return requestContext.getUser();
}
//#endregion
export { requestContext, useCurrentUser, useRequest, useRequestStore };

//# sourceMappingURL=request-context.mjs.map