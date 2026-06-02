import { config } from "../config/config-getter.mjs";
import { createRequestStore } from "./middleware/inject-request-context.mjs";
import { validateAll } from "../validation/validateAll.mjs";
import { Response } from "./response.mjs";
import { UploadedFile } from "./uploaded-file.mjs";
import { v } from "@warlock.js/seal";
import { trans, transFrom } from "@mongez/localization";
import { log } from "@warlock.js/logger";
import { isEmpty } from "@mongez/supportive-is";
import { Random, except, get, only, rtrim, set, unset } from "@mongez/reinforcements";
import { colors } from "@mongez/copper";
import events from "@mongez/events";
//#region ../../@warlock.js/core/src/http/request.ts
var Request = class Request {
	constructor() {
		this.payload = {};
		this.trans = trans;
		this.t = trans;
		this._locale = "";
		this.id = Random.string(32);
		this.startTime = Date.now();
	}
	/**
	* Set request handler
	*/
	setRequest(request) {
		this.baseRequest = request;
		this.resolveRequestId();
		this.parsePayload();
		const localeCode = this.getLocaleCode();
		this.trans = this.t = transFrom.bind(null, localeCode);
		return this;
	}
	/**
	* Inherit `X-Request-Id` from the incoming request, fall back to a custom
	* generator, then to the field-init default (`Random.string(32)`).
	*
	* Inherited values are validated (length cap + printable-ASCII) to prevent
	* log-injection from a malicious client. Disable the whole behavior by
	* setting `http.requestId.enabled = false` — in which case the field-init
	* default is used regardless of any incoming header.
	*/
	resolveRequestId() {
		const requestIdConfig = config.key("http.requestId") || {};
		if (requestIdConfig.enabled === false) return;
		const headerName = (requestIdConfig.header || "x-request-id").toLowerCase();
		const incoming = this.baseRequest.headers[headerName];
		if (Request.isValidRequestId(incoming)) {
			this.id = incoming;
			return;
		}
		if (typeof requestIdConfig.generator === "function") this.id = requestIdConfig.generator();
	}
	/**
	* Validate a candidate request-id value. Accepts non-empty printable ASCII
	* up to 128 characters — tight enough to reject newline / control-character
	* log-injection, loose enough to accept UUIDs, ULIDs, snowflakes, etc.
	*/
	static isValidRequestId(value) {
		return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[\x21-\x7e]+$/.test(value);
	}
	/**
	* Translate from the given locale code
	*/
	transFrom(localeCode, keyword, placeholders) {
		return transFrom(localeCode, keyword, placeholders);
	}
	/**
	* Get current locale code
	*/
	get locale() {
		if (this._locale) return this._locale;
		return this.header("translation-locale-code") || this.localized;
	}
	/**
	* Set locale code
	*/
	set locale(localeCode) {
		this._locale = localeCode;
	}
	/**
	* Get locale code that will be used for translation
	*/
	get localized() {
		if (this._locale) return this._locale;
		return this._locale = this.header("locale") || this.query["locale"];
	}
	/**
	* Set locale code
	*/
	setLocaleCode(localeCode) {
		this._locale = localeCode;
		return this;
	}
	/**
	* Get current locale code or return default locale code
	*/
	getLocaleCode(defaultLocaleCode = config.key("app.localeCode") || "en") {
		return this.locale || defaultLocaleCode;
	}
	/**
	* Get http protocol
	*/
	get protocol() {
		return this.baseRequest.protocol;
	}
	/**
	* Validate the given validation schema
	*/
	async validate(validation, selectedInputs) {
		return await v.validate(validation, selectedInputs ? this.only(selectedInputs) : this.all());
	}
	/**
	* Clear current user
	*/
	clearCurrentUser() {
		this.user = void 0;
	}
	/**
	* Get value of the given header
	*/
	header(name, defaultValue = null) {
		return this.baseRequest.headers[name.toLocaleLowerCase()] ?? defaultValue;
	}
	/**
	* Get all cookies from the current request
	*/
	get cookies() {
		return this.baseRequest.cookies || {};
	}
	/**
	* Get a particular cookie value or fallback to default
	*/
	cookie(name, defaultValue) {
		const value = this.cookies[name] ?? defaultValue;
		try {
			return JSON.parse(value);
		} catch (error) {
			return value;
		}
	}
	/**
	* Determine if the request has the specified cookie
	*/
	hasCookie(name) {
		return this.cookies[name] !== void 0;
	}
	/**
	* Get the current request domain
	*/
	get domain() {
		return this.baseRequest.hostname.replace(/^www\./, "");
	}
	/**
	* Get hostname
	*/
	get hostname() {
		return this.domain;
	}
	/**
	* Get request origin
	*/
	get origin() {
		return this.baseRequest.headers.origin;
	}
	/**
	* Get the domain of the origin
	*/
	get originDomain() {
		const domain = this.origin ? new URL(this.origin).hostname : null;
		if (domain?.startsWith("www.")) return domain.replace(/^www\./, "");
		return domain;
	}
	/**
	* Get authorization header value
	*/
	get authorizationValue() {
		const authorization = this.header("authorization");
		if (!authorization) return "";
		const [type, value] = authorization.split(" ");
		if (!["bearer", "key"].includes(type.toLowerCase())) return "";
		return value || "";
	}
	/**
	* Get access token from Authorization header
	*
	* If the Authorization header does not start with `Bearer` value then return null
	*/
	get accessToken() {
		const authorization = this.header("authorization");
		if (!authorization) return;
		const [type, value] = authorization.split(" ");
		if (type.toLowerCase() !== "bearer") return;
		return value;
	}
	/**
	* Get the authorization header
	*/
	get authorization() {
		return this.header("authorization");
	}
	/**
	* Get current request method
	*/
	get method() {
		return this.baseRequest.method;
	}
	/**
	* Parse the payload and merge it from the request body, params and query string
	*/
	parsePayload() {
		this.payload.body = this.parseBody(this.baseRequest.body);
		this.payload.query = this.parseBody(this.baseRequest.query);
		this.payload.params = { ...this.baseRequest.params || {} };
		this.payload.all = {
			...this.payload.body,
			...this.payload.query,
			...this.payload.params
		};
	}
	/**
	* Parse body payload
	*/
	parseBody(data) {
		try {
			if (!data) return {};
			const body = {};
			const arrayOfObjectValues = {};
			for (let key in data) {
				const value = data[key];
				let isArrayKey = false;
				if (key.endsWith("[]")) isArrayKey = true;
				key = rtrim(key, "[]");
				if (key.includes("[")) {
					if (key.includes("][")) {
						const keyParts = key.split("[");
						const keyName = keyParts[0];
						if (!arrayOfObjectValues[keyName]) arrayOfObjectValues[keyName] = [];
						const keyNameParts = keyParts[1].split("]");
						const index = Number(keyNameParts[0]);
						if (!arrayOfObjectValues[keyName][index]) arrayOfObjectValues[keyName][index] = {};
						const keyName2 = keyParts[2].split("]")[0];
						arrayOfObjectValues[keyName][index][keyName2] = this.parseValue(value);
						continue;
					}
					const keyParts = key.split("[");
					const keyName = keyParts[0];
					const keyNameParts = keyParts[1].split("]");
					set(body, keyName + "." + keyNameParts[0], Array.isArray(value) ? value.map(this.parseValue.bind(this)) : this.parseValue(value));
					continue;
				}
				if (Array.isArray(value)) set(body, key, value.map(this.parseValue.bind(this)));
				else if (isArrayKey) if (body[key]) body[key].push(this.parseValue(value));
				else {
					body[key] = [this.parseValue(value)];
					continue;
				}
				else set(body, key, this.parseValue(value));
			}
			for (const key in arrayOfObjectValues) body[key] = arrayOfObjectValues[key];
			return body;
		} catch (error) {
			console.log(error);
			this.log(error, "error");
		}
	}
	/**
	* Parse the given data
	*/
	parseValue(data) {
		if (data?.file) return new UploadedFile(data);
		if (data?.value !== void 0 && data?.fields && data?.type) data = data.value;
		if (data === "false") return false;
		if (data === "true") return true;
		if (data === "null") return null;
		if (typeof data === "string") return data.trim();
		return data;
	}
	/**
	* Set route handler
	*/
	setRoute(route) {
		this.route = route;
		this.response.setRoute(route);
		return this;
	}
	/**
	* Trigger an http event
	*/
	trigger(eventName, ...args) {
		return events.trigger(`request.${eventName}`, ...args, this);
	}
	/**
	* Listen to the given event
	*/
	on(eventName, callback) {
		return this.subscribe(eventName, callback);
	}
	/**
	* Make a log message
	*/
	log(message, level = "info") {
		if (!config.key("http.log")) return;
		log.log({
			module: "request",
			action: this.route.method + " " + this.route.path.replace("/*", "") + `:${this.id}`,
			message,
			type: level,
			context: { request: this }
		});
	}
	/**
	* Get current request path
	*/
	get path() {
		return this.baseRequest.url;
	}
	/**
	* {@alias}
	*/
	get url() {
		return this.baseRequest.url;
	}
	/**
	* Get full url
	*/
	get fullUrl() {
		return this.protocol + "://" + this.hostname + this.path;
	}
	/**
	* Drive the middleware chain for the current route, then defer to the
	* controller. Returns the first response value any middleware short-circuits
	* with, or `undefined` to continue into validation + handler.
	*
	* @internal Framework orchestration — do not call from app code. Will move
	* to a dedicated controller dispatcher in a future refactor.
	*/
	async runMiddleware() {
		const middlewareOutput = await this.executeMiddleware();
		if (middlewareOutput !== void 0) {
			if (middlewareOutput instanceof Response) return middlewareOutput;
			return this.response.send(middlewareOutput);
		}
		const handler = this.route.handler;
		if (!handler.validation) return;
		return await validateAll(handler.validation, this, this.response);
	}
	/**
	* Return the request handler attached to the current route.
	*
	* @internal Framework orchestration — do not call from app code.
	*/
	getHandler() {
		return this.route.handler;
	}
	/**
	* Get inputs that has been validated only
	* You can also pass an array of inputs to get only the validated inputs
	*/
	validated(inputs) {
		if (this.validatedData) return inputs ? only(this.validatedData, inputs) : this.validatedData;
		return {};
	}
	/**
	* Get inputs that has been validated except the given inputs
	*/
	validatedExcept(...inputs) {
		return except(this.validated(), inputs);
	}
	/**
	* Set validated data
	*/
	setValidatedData(data) {
		this.validatedData = data;
	}
	/**
	* Top-level entry into the request lifecycle — opens the context store,
	* runs middleware, drives the handler, handles errors.
	*
	* @internal Framework orchestration — do not call from app code. Wired
	* from the Fastify route handler in `router.scan()`.
	*/
	async execute() {
		try {
			this.log("Executing the request");
			return await createRequestStore(this, this.response);
		} catch (error) {
			this.log(error, "error");
			throw error;
		}
	}
	/**
	* Iterate the collected middlewares in order; return the first short-circuit
	* value or `undefined` when every middleware passes through.
	*
	* @internal Framework orchestration — do not call from app code.
	*/
	async executeMiddleware() {
		const middlewares = this.collectMiddlewares();
		if (middlewares.length === 0) return;
		this.log("About to execute request middlewares");
		this.trigger("executingMiddleware", middlewares, this.route);
		for (const middleware of middlewares) {
			this.log("Executing middleware " + colors.yellowBright(middleware.name));
			const output = await middleware(this, this.response);
			this.log("Executed middleware " + colors.yellowBright(middleware.name), "success");
			if (output !== void 0) {
				this.log(colors.yellow("request intercepted by middleware ") + colors.cyanBright(middleware.name), "warn");
				this.trigger("executedMiddleware");
				this.log("Request middlewares executed", "success");
				return output;
			}
		}
		this.log("Request middlewares executed", "success");
		this.trigger("executedMiddleware", middlewares, this.route);
	}
	/**
	* Gather the middleware list for the current route — today just the
	* route-level array; future extraction may merge group + app-wide layers.
	*
	* @internal Framework orchestration — do not call from app code.
	*/
	collectMiddlewares() {
		const middlewaresList = [];
		if (this.route.middleware) middlewaresList.push(...this.route.middleware);
		return middlewaresList;
	}
	/**
	* Get request input value from query string, params or body
	*/
	input(key, defaultValue) {
		return get(this.payload.all, key, defaultValue);
	}
	/**
	* Get email input value, this will lowercase the value
	*/
	email(key = "email", defaultValue = "") {
		return this.input(key, defaultValue)?.toLowerCase() || defaultValue;
	}
	/**
	* @alias input
	*/
	get(key, defaultValue) {
		return this.input(key, defaultValue);
	}
	/**
	* Determine if request has input value
	*/
	has(key) {
		return get(this.payload.all, key, void 0) !== void 0;
	}
	/**
	* Set request input value
	*/
	set(key, value) {
		set(this.payload.all, key, value);
		return this;
	}
	/**
	* Set the given value if the request does not have the input
	*/
	setDefault(key, value) {
		if (this.has(key)) return this;
		set(this.payload.all, key, value);
		return this;
	}
	/**
	* Unset request payload keys
	*/
	unset(...keys) {
		this.payload.all = unset(this.payload.all, keys);
		return this;
	}
	/**
	* Get request body
	*/
	get body() {
		return this.payload.body;
	}
	/**
	* Set request body value
	*/
	setBody(key, value) {
		set(this.payload.body, key, value);
		return this;
	}
	/**
	* Get body inputs except files
	*/
	get bodyInputs() {
		const inputs = this.payload.body;
		const bodyInputs = {};
		for (const key in inputs) {
			const value = inputs[key];
			if (value.file && value.fieldname) continue;
			bodyInputs[key] = value;
		}
		return bodyInputs;
	}
	/**
	* Get request file in UploadedFile instance
	*/
	file(key) {
		return this.input(key);
	}
	/**
	* Get uploaded files from the request for the given name
	* If the given name is not present in the request, return an empty array
	*/
	files(name) {
		return this.input(name) || [];
	}
	/**
	* Get request params
	*/
	get params() {
		return this.payload.params;
	}
	/**
	* Set request params value
	*/
	setParam(key, value) {
		set(this.payload.params, key, value);
		return this;
	}
	/**
	* Get request query
	*/
	get query() {
		return this.payload.query;
	}
	/**
	* Set request query value
	*/
	setQuery(key, value) {
		set(this.payload.query, key, value);
		return this;
	}
	/**
	* Get all inputs
	*/
	all() {
		return this.payload.all;
	}
	/**
	* Get all inputs except params
	*/
	allExceptParams() {
		return {
			...this.payload.query,
			...this.payload.body
		};
	}
	/**
	* Get all heavy inputs except params
	*/
	heavyExceptParams() {
		const inputs = this.allExceptParams();
		const heavyInputs = {};
		for (const key in inputs) {
			const value = inputs[key];
			if (isEmpty(value) && value !== null) continue;
			heavyInputs[key] = value;
		}
		return heavyInputs;
	}
	/**
	* Get only heavy inputs, the input with a value
	*/
	heavy() {
		const inputs = this.all();
		const heavyInputs = {};
		for (const key in inputs) {
			const value = inputs[key];
			if (isEmpty(value) && value !== null) continue;
			heavyInputs[key] = value;
		}
		return heavyInputs;
	}
	/**
	* Get only the given keys from the request data
	*/
	only(keys) {
		return only(this.all(), keys);
	}
	/**
	* Pluck the given keys from the request data
	*/
	pluck(keys) {
		const data = this.only(keys);
		this.unset(...keys);
		return data;
	}
	/**
	* Get all request inputs except the given keys
	*/
	except(keys) {
		return except(this.all(), keys);
	}
	/**
	* Get boolean input value
	*/
	bool(key, defaultValue = false) {
		const value = this.input(key, defaultValue);
		if (value === "true") return true;
		if (value === "false") return false;
		if (value === 0) return false;
		return Boolean(value);
	}
	/**
	* Get integer input value
	*/
	int(key, defaultValue = 0) {
		const value = this.input(key, defaultValue);
		if (!value && value !== 0) return void 0;
		return parseInt(value);
	}
	/**
	* Shorthand getter to get id param
	*/
	get idParam() {
		return this.int("id");
	}
	/**
	* Get string input value
	*/
	string(key, defaultValue = "") {
		const value = this.input(key, defaultValue);
		return String(value);
	}
	/**
	* Get float input value
	*/
	float(key, defaultValue = 0) {
		const value = this.input(key, defaultValue);
		return parseFloat(value) || 0;
	}
	/**
	* Get number input value
	*/
	number(key, defaultValue = 0) {
		const value = Number(this.input(key, defaultValue));
		return isNaN(value) ? defaultValue : value;
	}
	/**
	* Immediate-peer IP as Fastify reports it — the address that connected to
	* the server socket, with `trustProxy` resolution applied. Use this when
	* you specifically need the peer address (rate-limit-by-direct-connection,
	* health-check origin verification).
	*
	* **For most use cases prefer `request.detectIp()`** — behind any proxy
	* (load balancer, CDN, sidecar) `ip` reports the proxy, not the real client.
	*/
	get ip() {
		return this.baseRequest.ip;
	}
	/**
	* Best-effort real client IP — checks `X-Real-IP` and `X-Forwarded-For`
	* headers first, falls back to `baseRequest.ip` when neither is present.
	*
	* **Prefer this over `request.ip` for any caller behind a proxy** (load
	* balancer, CDN, reverse proxy, k8s ingress). Only trust the result as
	* far as you trust the upstream proxy chain — `X-Forwarded-For` is
	* client-settable; verify the request came through your trusted edge
	* before treating the value as authoritative.
	*/
	detectIp() {
		const realIp = this.header("x-real-ip");
		if (realIp) return realIp;
		return this.header("x-forwarded-for") || this.baseRequest.ip;
	}
	/**
	* An alias to detectIp
	*/
	get realIp() {
		return this.detectIp();
	}
	/**
	* Get request ips
	*/
	get ips() {
		return this.baseRequest.ips;
	}
	/**
	* Get request referer
	*/
	get referer() {
		return this.baseRequest.headers.referer;
	}
	/**
	* Get user agent
	*/
	get userAgent() {
		return this.baseRequest.headers["user-agent"];
	}
	/**
	* Get request headers
	*/
	get headers() {
		return this.baseRequest.headers;
	}
	/**
	* Set the given header
	*/
	setHeader(key, value) {
		this.baseRequest.headers[key.toLowerCase()] = value;
		return this;
	}
};
//#endregion
export { Request };

//# sourceMappingURL=request.mjs.map