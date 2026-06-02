import FindMyWay from "find-my-way";
//#region ../../@warlock.js/core/src/router/route-registry.ts
/**
* Route Registry
* Manages dynamic route matching using find-my-way for HMR support
*/
var RouteRegistry = class {
	constructor() {
		this.router = FindMyWay({
			ignoreTrailingSlash: true,
			caseSensitive: false
		});
	}
	/**
	* Register all routes from the router's internal list
	*/
	register(routes) {
		for (const route of routes) if (route.method === "all") {
			this.registerRoute({
				...route,
				method: "GET"
			});
			this.registerRoute({
				...route,
				method: "POST"
			});
		} else this.registerRoute(route);
	}
	/**
	* Register a single route
	*/
	registerRoute(route) {
		this.router.on(route.method, route.path, (req, res, params) => {
			return {
				route,
				params
			};
		});
	}
	/**
	* Find a matching route for the given method and URL
	* @returns Matched route with extracted params, or null if no match
	*/
	find(method, url) {
		const path = url.split("?")[0];
		const match = this.router.find(method, path);
		if (!match) return null;
		return match.handler(null, null, match.params, match.store, {});
	}
	/**
	* Get all registered routes count (for debugging)
	*/
	getRouteCount() {
		return this.router.prettyPrint().split("\n").filter((line) => line.trim()).length;
	}
};
//#endregion
export { RouteRegistry };

//# sourceMappingURL=route-registry.mjs.map