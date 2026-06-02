import { container } from "../container/index.mjs";
import { Response } from "../http/response.mjs";
import { Request } from "../http/request.mjs";
import { RouteBuilder } from "./route-builder.mjs";
import { RouteRegistry } from "./route-registry.mjs";
import { log } from "@warlock.js/logger";
import { isEmpty } from "@mongez/supportive-is";
import { ltrim, merge, toCamelCase, trim } from "@mongez/reinforcements";
import proxy from "@fastify/http-proxy";
import fastifyStatic from "@fastify/static";
import concatRoute from "@mongez/concat-route";
//#region ../../@warlock.js/core/src/router/router.ts
var Router = class Router {
	/**
	* Get router instance
	*/
	static getInstance() {
		if (!Router.instance) Router.instance = new Router();
		return Router.instance;
	}
	constructor() {
		this.routes = [];
		this.staticDirectories = [];
		this.eventListeners = {};
		this.stacks = {
			prefix: [],
			name: [],
			middleware: []
		};
	}
	/**
	* Listen to router before scan
	*/
	beforeScanning(callback) {
		this.eventListeners.beforeScan = [...this.eventListeners.beforeScan || [], callback];
		return this;
	}
	/**
	* Listen to router after scanning
	*/
	afterScanning(callback) {
		this.eventListeners.afterScanning = [...this.eventListeners.afterScanning || [], callback];
		return this;
	}
	/**
	* Redirect path to another path
	*/
	redirect(from, to, redirectMode = "temporary") {
		return this.get(from, (_request, response) => {
			response.redirect(to, redirectMode === "temporary" ? 302 : 301);
		});
	}
	/**
	* Server static folder
	*/
	directory(options) {
		this.staticDirectories.push(options);
		return this;
	}
	/**
	* Serve file
	*/
	file(path, location, cacheTime) {
		return this.get(path, (_request, response) => {
			response.sendFile(location, cacheTime);
		});
	}
	/**
	* Serve cached file, it will cache the file to 1 year by default
	*/
	cachedFile(path, location, cacheTime) {
		return this.get(path, (_request, response) => {
			response.sendCachedFile(location, cacheTime);
		});
	}
	/**
	* Serve list of files
	*/
	files(files, cacheTime) {
		for (const [path, location] of Object.entries(files)) this.get(path, (_request, response) => {
			response.sendFile(location, cacheTime);
		});
	}
	/**
	* Serve list of cached files, it will cache the file to 1 year by default
	*/
	cachedFiles(files, cacheTime) {
		for (const [path, location] of Object.entries(files)) this.get(path, (_request, response) => {
			response.sendCachedFile(location, cacheTime);
		});
	}
	proxy(...args) {
		this.beforeScanning((_router, server) => {
			if (args.length === 1) server.register(proxy, args[0]);
			else server.register(proxy, {
				prefix: args[0],
				upstream: args[1],
				...args[2]
			});
		});
		return this;
	}
	/**
	* Add route to routes list
	*/
	add(method, path, handler, options = {}) {
		if (Array.isArray(path)) {
			path.forEach((p) => this.add(method, p, handler, options));
			return this;
		}
		const prefix = this.stacks.prefix.reduce((path, prefix) => {
			return concatRoute(path, prefix);
		}, "");
		const name = this.stacks.name.reduceRight((name, prefixName) => {
			return trim(prefixName + "." + name, ".");
		}, options.name || trim(path.replace(/\//g, "."), "."));
		path = concatRoute(prefix, path);
		if ((options.middlewarePrecedence || "after") === "before") options.middleware = [...options.middleware || [], ...this.stacks.middleware];
		else options.middleware = [...this.stacks.middleware, ...options.middleware || []];
		if (Array.isArray(handler)) {
			const [controller, action] = handler;
			if (typeof controller[action] !== "function") throw new Error(`Invalid controller action "${action}" for controller "${controller.constructor.name}"`);
			handler = controller[action].bind(controller);
			if (!handler.validation) {
				handler.validation = {};
				if (controller[`${action}ValidationSchema`]) handler.validation.schema = controller[`${action}ValidationSchema`]();
				if (controller[`${action}Validate`]) handler.validation.validate = controller[`${action}Validate`];
			}
		}
		const routeData = {
			method,
			path,
			handler,
			...options,
			name,
			rateLimit: options.rateLimit,
			$prefix: prefix || "/",
			$prefixStack: [...this.stacks.prefix],
			sourceFile: this.stacks.sourceFile || ""
		};
		if (routeData.name) {
			const route = this.routes.find((route) => route.name === routeData.name);
			if (route) if (route.method === routeData.method) throw new Error(`Route name "${routeData.name}" already exists`);
			else routeData.name += `.${routeData.method.toLowerCase()}`;
		}
		this.routes.push(routeData);
		return this;
	}
	/**
	* Add a request that accepts all methods
	*/
	any(path, handler, options = {}) {
		return this.add("all", path, handler, options);
	}
	/**
	* Add get request method
	*/
	get(path, handler, options = {}) {
		return this.add("GET", path, handler, options);
	}
	/**
	* Add post request method
	*/
	post(path, handler, options = {}) {
		return this.add("POST", path, handler, options);
	}
	/**
	* Add put request method
	*/
	put(path, handler, options = {}) {
		return this.add("PUT", path, handler, options);
	}
	/**
	* Add delete request method
	*/
	delete(path, handler, options = {}) {
		return this.add("DELETE", path, handler, options);
	}
	/**
	* Add patch request method
	*/
	patch(path, handler, options = {}) {
		return this.add("PATCH", path, handler, options);
	}
	/**
	* Add head request method
	*/
	head(path, handler, options = {}) {
		return this.add("HEAD", path, handler, options);
	}
	/**
	* Add options request method
	*/
	options(path, handler, options = {}) {
		return this.add("OPTIONS", path, handler, options);
	}
	/**
	* Get a chainable route builder for the same route path
	*/
	route(path, options = {}) {
		return new RouteBuilder(this, path, options);
	}
	/**
	* Add full restful resource routes
	* This method will generate the following routes:
	* 1. GET /path: list all resources
	* 2. GET /path/:id: get a single resource
	* 3. POST /path: create a new resource
	* 4. PUT /path/:id: update a resource
	* 5. DELETE /path/:id: delete a resource
	* 6. PATCH /path/:id: update a resource partially
	*/
	restfulResource(path, resource, options = {}) {
		return this.prefix(path, () => {
			path = "";
			const baseResourceName = options.name || toCamelCase(ltrim(path, "/"));
			const routeResource = resource;
			const isAcceptableResource = (type) => {
				return Boolean((!options.except || !options.except.includes(type)) && (!options.only || options.only.includes(type)));
			};
			if (routeResource.list && isAcceptableResource("list")) {
				const resourceName = baseResourceName + ".list";
				this.get(path, options.replace?.list || routeResource.list.bind(routeResource), {
					...options,
					name: resourceName,
					restful: true
				});
			}
			if (routeResource.get && isAcceptableResource("get")) {
				const resourceName = baseResourceName + ".single";
				this.get(path + "/:id", options.replace?.get || routeResource.get.bind(routeResource), {
					...options,
					name: resourceName,
					restful: true
				});
			}
			if (routeResource.create && isAcceptableResource("create")) {
				const resourceName = baseResourceName + ".create";
				const handler = options.replace?.create || this.manageValidation(routeResource, "create");
				this.post(path, handler, {
					...options,
					name: resourceName,
					restful: true
				});
			}
			if (routeResource.update && isAcceptableResource("update")) {
				const resourceName = baseResourceName + ".update";
				const handler = options.replace?.update || this.manageValidation(routeResource, "update");
				this.put(path + "/:id", handler, {
					...options,
					name: resourceName,
					restful: true
				});
			}
			if (routeResource.patch && isAcceptableResource("patch")) {
				const resourceName = baseResourceName + ".patch";
				const handler = options.replace?.patch || this.manageValidation(routeResource, "patch");
				this.patch(path + "/:id", handler, {
					...options,
					name: resourceName,
					restful: true
				});
			}
			if (routeResource.delete && isAcceptableResource("delete")) {
				const resourceName = baseResourceName + ".delete";
				this.delete(path + "/:id", options.replace?.delete || routeResource.delete.bind(routeResource), {
					...options,
					name: resourceName,
					restful: true
				});
			}
			if (routeResource.bulkDelete && isAcceptableResource("delete")) {
				const resourceName = baseResourceName + ".bulkDelete";
				this.delete(path, options.replace?.bulkDelete || routeResource.bulkDelete.bind(routeResource), {
					...options,
					name: resourceName,
					restful: true
				});
			}
			return this;
		});
	}
	/**
	* Group routes with options
	*/
	group(options, callback) {
		const { prefix, name = prefix ? trim(prefix.replace(/\//g, "."), ".") : void 0, middleware } = options;
		if (prefix) this.stacks.prefix.push(prefix);
		if (name) this.stacks.name.push(name);
		if (middleware) this.stacks.middleware.push(...middleware);
		callback();
		if (prefix) this.stacks.prefix.pop();
		if (name) this.stacks.name.pop();
		if (middleware) this.stacks.middleware.splice(this.stacks.middleware.length - middleware.length, middleware.length);
		return this;
	}
	/**
	* Add prefix to all routes in the given callback
	*/
	prefix(prefix, callback) {
		return this.group({ prefix }, callback);
	}
	/**
	* Add API version prefix to all routes in the given callback
	* Automatically formats the version as /v{version}
	* @example
	* router.version("1", () => {
	*   router.get("/users", getUsersV1); // /v1/users
	* });
	*
	* router.version("2", () => {
	*   router.get("/users", getUsersV2); // /v2/users
	* });
	*/
	version(version, callback) {
		return this.prefix(`/v${version}`, callback);
	}
	/**
	* Wrap route additions with a source file path
	* Used for tracking which routes come from which file (for HMR)
	* @param sourceFile Relative path to the source file (e.g., "src/app/users/routes.ts")
	* @param callback Function that adds routes (will have sourceFile injected)
	*/
	async withSourceFile(sourceFile, callback) {
		this.stacks.sourceFile = sourceFile;
		try {
			return await callback();
		} catch (error) {
			console.log("Error in withSourceFile", error);
		} finally {
			delete this.stacks.sourceFile;
		}
	}
	/**
	* Remove all routes that belong to a specific source file
	* Used when reloading routes files via HMR
	* @param sourceFile Relative path to the source file
	*/
	removeRoutesBySourceFile(sourceFile) {
		this.routes = this.routes.filter((route) => route.sourceFile !== sourceFile);
	}
	/**
	* Manage validation system for the given resource
	*/
	manageValidation(resource, method) {
		const handler = resource[method]?.bind(resource);
		const methodValidation = resource?.validation?.[method];
		if (method === "patch") {
			handler.validation = methodValidation;
			if (handler.validation?.validate) handler.validation.validate = handler.validation.validate.bind(resource);
			if (resource.validation?.patch) handler.validation = merge(resource.validation.patch, handler.validation);
			return handler;
		}
		if (!resource.validation || !methodValidation && !resource.validation.all) return handler;
		if (resource.validation.all) {
			const validationMethods = {
				all: resource?.validation?.all?.validate,
				[method]: methodValidation?.validate
			};
			const validation = {};
			if (resource.validation.all.schema || methodValidation?.schema) {
				if (!methodValidation?.schema && resource.validation.all.schema) validation.schema = resource.validation.all.schema;
				else if (methodValidation?.schema && resource.validation.all.schema) validation.schema = resource.validation.all.schema.merge(methodValidation.schema);
				else if (methodValidation?.schema && !resource.validation.all.schema) validation.schema = methodValidation.schema;
			}
			if (validationMethods.all || validationMethods[method]) validation.validate = async (request, response) => {
				if (validationMethods.all) {
					const output = await validationMethods.all.call(resource, request, response);
					if (output) return output;
				}
				if (validationMethods[method]) return await validationMethods[method]?.call(resource, request, response);
			};
			if (!isEmpty(validation)) handler.validation = validation;
		} else {
			handler.validation = resource.validation[method];
			if (handler.validation?.validate) handler.validation.validate = handler.validation.validate.bind(resource);
		}
		return handler;
	}
	/**
	* Get all routes list
	*/
	list() {
		return this.routes;
	}
	/**
	* Register routes to the server
	*/
	scan(server) {
		this.eventListeners.beforeScan?.forEach((callback) => callback(this, server));
		this.routes.forEach((route) => {
			const requestMethodFunction = server[route.method.toLowerCase()].bind(server);
			const options = {
				...route.serverOptions,
				config: {
					...route.serverOptions?.config,
					...route.rateLimit && { rateLimit: route.rateLimit }
				}
			};
			requestMethodFunction(route.path, options, async (baseRequest, reply) => {
				const { output, response } = await this.handleRoute(route)(baseRequest, reply);
				return output || response.baseResponse;
			});
		});
		for (const directoryOptions of this.staticDirectories) server.register(fastifyStatic, {
			...directoryOptions,
			decorateReply: false
		});
		this.eventListeners.afterScanning?.forEach((callback) => callback(this, server));
	}
	/**
	* Scan routes for the development server
	* Uses wildcard routing with find-my-way for HMR support
	*/
	scanDevServer(server) {
		this.eventListeners.beforeScan?.forEach((callback) => callback(this, server));
		const wildcardHandler = async (fastifyRequest, fastifyReply) => {
			const routeRegistry = new RouteRegistry();
			routeRegistry.register(this.routes);
			const match = routeRegistry.find(fastifyRequest.method, fastifyRequest.url);
			if (!match) return fastifyReply.code(404).send({
				error: "Route not found",
				path: fastifyRequest.url,
				method: fastifyRequest.method
			});
			fastifyRequest.params = match.params;
			try {
				const { output, response } = await this.handleRoute(match.route)(fastifyRequest, fastifyReply);
				return output || response.baseResponse;
			} catch (error) {
				console.log(error);
				throw error;
			}
		};
		for (const method of [
			"GET",
			"POST",
			"PUT",
			"DELETE",
			"PATCH"
		]) server.route({
			method,
			url: "*",
			handler: wildcardHandler
		});
		for (const directoryOptions of this.staticDirectories) server.register(fastifyStatic, {
			...directoryOptions,
			decorateReply: false
		});
		this.eventListeners.afterScanning?.forEach((callback) => callback(this, server));
	}
	/**
	* Get the route path for the given route name
	*/
	getRoute(name, params = {}) {
		const route = this.routes.find((route) => route.name === name);
		if (!route) throw new Error(`Route name "${name}" not found`);
		let path = route.path;
		if (route.path.includes(":")) Object.keys(params).forEach((key) => {
			path = path.replace(":" + key, params[key]);
		});
		return path;
	}
	/**
	* Handle the given route
	*/
	handleRoute(route) {
		return async (fastifyRequest, fastifyResponse) => {
			const request = new Request();
			const response = new Response();
			response.setResponse(fastifyResponse);
			request.response = response;
			response.request = request;
			request.setRequest(fastifyRequest).setRoute(route);
			log.info({
				module: "route",
				action: route.method + " " + route.path.replace("/*", ""),
				message: `Starting Request: ${request.id}`,
				context: {
					request,
					response
				}
			});
			return {
				output: await request.execute(),
				response,
				request
			};
		};
	}
};
const router = Router.getInstance();
container.set("router", router);
//#endregion
export { Router, router };

//# sourceMappingURL=router.mjs.map