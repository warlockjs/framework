import { StorageFile } from "../storage/storage-file.mjs";
import "../storage/index.mjs";
import { renderReact } from "../react/index.mjs";
import baseConfig from "@mongez/config";
import { log } from "@warlock.js/logger";
import path from "path";
import { isIterable, isPlainObject, isScalar } from "@mongez/supportive-is";
import events from "@mongez/events";
import { fileExistsAsync } from "@warlock.js/fs";
import fs from "fs";
import mime from "mime";
//#region ../../@warlock.js/core/src/http/response.ts
let ResponseStatus = /* @__PURE__ */ function(ResponseStatus) {
	ResponseStatus[ResponseStatus["OK"] = 200] = "OK";
	ResponseStatus[ResponseStatus["CREATED"] = 201] = "CREATED";
	ResponseStatus[ResponseStatus["ACCEPTED"] = 202] = "ACCEPTED";
	ResponseStatus[ResponseStatus["MOVED_PERMANENTLY"] = 301] = "MOVED_PERMANENTLY";
	ResponseStatus[ResponseStatus["FOUND"] = 302] = "FOUND";
	ResponseStatus[ResponseStatus["SEE_OTHER"] = 303] = "SEE_OTHER";
	ResponseStatus[ResponseStatus["NOT_MODIFIED"] = 304] = "NOT_MODIFIED";
	ResponseStatus[ResponseStatus["TEMPORARY_REDIRECT"] = 307] = "TEMPORARY_REDIRECT";
	ResponseStatus[ResponseStatus["PERMANENT_REDIRECT"] = 308] = "PERMANENT_REDIRECT";
	ResponseStatus[ResponseStatus["NO_CONTENT"] = 204] = "NO_CONTENT";
	ResponseStatus[ResponseStatus["BAD_REQUEST"] = 400] = "BAD_REQUEST";
	ResponseStatus[ResponseStatus["UNAUTHORIZED"] = 401] = "UNAUTHORIZED";
	ResponseStatus[ResponseStatus["FORBIDDEN"] = 403] = "FORBIDDEN";
	ResponseStatus[ResponseStatus["NOT_FOUND"] = 404] = "NOT_FOUND";
	ResponseStatus[ResponseStatus["METHOD_NOT_ALLOWED"] = 405] = "METHOD_NOT_ALLOWED";
	ResponseStatus[ResponseStatus["CONFLICT"] = 409] = "CONFLICT";
	ResponseStatus[ResponseStatus["TOO_MANY_REQUESTS"] = 429] = "TOO_MANY_REQUESTS";
	ResponseStatus[ResponseStatus["INTERNAL_SERVER_ERROR"] = 500] = "INTERNAL_SERVER_ERROR";
	ResponseStatus[ResponseStatus["SERVICE_UNAVAILABLE"] = 503] = "SERVICE_UNAVAILABLE";
	return ResponseStatus;
}({});
var Response = class Response {
	constructor() {
		this.currentStatusCode = 200;
		this.events = /* @__PURE__ */ new Map();
	}
	/**
	* Get raw response
	*/
	get raw() {
		return this.baseResponse.raw;
	}
	/**
	* Get Current response body
	*/
	get body() {
		return this.currentBody;
	}
	/**
	* Set response body
	*/
	set body(body) {
		this.currentBody = body;
	}
	/**
	* Add event on sending response
	*/
	onSending(callback) {
		this.events.set("sending", [...this.events.get("sending") || [], callback]);
		return this;
	}
	/**
	* Add event on sent response
	*/
	onSent(callback) {
		this.events.set("sent", [...this.events.get("sent") || [], callback]);
		return this;
	}
	/**
	* Set the Fastify response object
	*/
	setResponse(response) {
		this.baseResponse = response;
		this.baseResponse.raw.once("finish", () => {
			this.request.endTime = Date.now();
		});
		return this;
	}
	/**
	* Reset the response state
	*/
	reset() {
		this.route = {};
		this.currentBody = null;
		this.currentStatusCode = 200;
	}
	/**
	* Set current route
	*/
	setRoute(route) {
		this.route = route;
		return this;
	}
	/**
	* Get the content type
	*/
	get contentType() {
		return this.baseResponse.getHeader("Content-Type");
	}
	/**
	* Set the content type
	*/
	setContentType(contentType) {
		this.baseResponse.header("Content-Type", contentType);
		return this;
	}
	/**
	* Get the status code
	*/
	get statusCode() {
		return this.currentStatusCode ?? this.baseResponse.statusCode;
	}
	/**
	* Check if response status is ok
	*/
	get isOk() {
		return this.currentStatusCode >= 200 && this.currentStatusCode < 300;
	}
	/**
	* Check if the response has been sent
	*/
	get sent() {
		return this.baseResponse.sent;
	}
	/**
	* Add a listener to the response event
	*/
	static on(event, listener) {
		return events.subscribe(`response.${event}`, listener);
	}
	/**
	* Trigger the response event
	*/
	static async trigger(event, ...args) {
		return new Promise((resolve) => {
			setTimeout(async () => {
				await events.triggerAllAsync(`response.${event}`, ...args);
				resolve(true);
			}, 0);
		});
	}
	/**
	* Parse body
	*/
	async parseBody() {
		return await this.parse(this.currentBody);
	}
	/**
	* Parse the given value
	*/
	async parse(value) {
		if (!value || isScalar(value)) return value;
		if (value.toJSON) {
			value.request = this.request;
			return await value.toJSON();
		}
		if (isIterable(value)) {
			const values = Array.from(value);
			return Promise.all(values.map(async (item) => {
				return await this.parse(item);
			}));
		}
		if (!isPlainObject(value)) return value;
		for (const key in value) {
			const subValue = value[key];
			value[key] = await this.parse(subValue);
		}
		return value;
	}
	/**
	* Make a log message
	*/
	log(message, level = "info") {
		if (!baseConfig.get("http.log")) return;
		log.log({
			module: "response",
			action: this.route.method + " " + this.route.path.replace("/*", "") + `:${this.request.id}`,
			message,
			type: level,
			context: {
				request: this.request,
				response: this
			}
		});
	}
	/**
	* Check if returning response is json
	*/
	get isJson() {
		return this.getHeader("Content-Type") === "application/json";
	}
	/**
	* Send the response
	* @param data - Response data
	* @param statusCode - HTTP status code
	* @param triggerEvents - Whether to trigger response events (default: true)
	*/
	async send(data, statusCode, triggerEvents = true) {
		if (this.baseResponse.sent) {
			log.error("response", "send", `send() called on already-sent response (request:${this.request?.id ?? "unknown"}) — likely a middleware bug`);
			return this;
		}
		if (statusCode) this.currentStatusCode = statusCode;
		if (data === this) return this;
		if (data) this.currentBody = data;
		if (!this.currentStatusCode) this.currentStatusCode = 200;
		this.log("Sending response");
		if (Array.isArray(this.currentBody) || isPlainObject(this.currentBody)) {
			if (!this.baseResponse.getHeader("Content-Type")) this.setContentType("application/json");
		}
		if (triggerEvents) {
			await Response.trigger("sending", this);
			for (const callback of this.events.get("sending") || []) await callback(this);
			if (this.isJson) {
				await Response.trigger("sendingJson", this);
				for (const callback of this.events.get("sendingJson") || []) await callback(this);
				if (this.isOk) {
					await Response.trigger("sendingSuccessJson", this);
					for (const callback of this.events.get("sendingSuccessJson") || []) await callback(this);
				}
			}
		}
		if (typeof this.currentBody !== "string") this.parsedBody = await this.parseBody();
		else this.parsedBody = data;
		this.baseResponse.status(this.currentStatusCode);
		await this.baseResponse.send(this.parsedBody);
		this.log("Response sent");
		if (triggerEvents) {
			Response.trigger("sent", this);
			for (const callback of this.events.get("sent") || []) callback(this);
			if (this.currentStatusCode >= 200 && this.currentStatusCode < 300) Response.trigger("success", this);
			if (this.currentStatusCode === 201) Response.trigger("successCreate", this);
			if (this.currentStatusCode === 400) Response.trigger("badRequest", this);
			if (this.currentStatusCode === 401) Response.trigger("unauthorized", this);
			if (this.currentStatusCode === 403) Response.trigger("forbidden", this);
			if (this.currentStatusCode === 404) Response.trigger("notFound", this);
			if (this.currentStatusCode === 413) Response.trigger("contentTooLarge", this);
			if (this.currentStatusCode === 429) Response.trigger("throttled", this);
			if (this.currentStatusCode === 500) Response.trigger("serverError", this);
			if (this.currentStatusCode >= 400) Response.trigger("error", this);
		}
		return this;
	}
	/**
	* Replay a previously-captured response shape — used by cache-pattern
	* middlewares (idempotency, response cache) to send a cached response
	* without re-running the controller.
	*
	* Preserves the cached status code, content-type, and any extra headers,
	* then sends the body through the standard `send()` pipeline so the full
	* event lifecycle still fires (`sent`, `success`, status-specific events).
	* That keeps cross-cutting observers (logger, metrics, audit) consistent
	* between fresh and replayed responses.
	*
	* @example
	* // Inside a cache-pattern middleware on HIT:
	* return response.header("X-Cache", "HIT").replay({
	*   status: cached.status,
	*   body: cached.body,
	*   contentType: cached.contentType,
	* });
	*/
	replay(cached) {
		this.setStatusCode(cached.status);
		if (cached.contentType) this.setContentType(cached.contentType);
		if (cached.headers) for (const [name, value] of Object.entries(cached.headers)) this.header(name, value);
		return this.send(cached.body);
	}
	/**
	* Send html response
	*/
	html(data, statusCode) {
		return this.setContentType("text/html").send(data, statusCode);
	}
	/**
	* Render the given react component
	*/
	render(element, status = 200) {
		return this.setStatusCode(status).html(renderReact(element));
	}
	/**
	* Send xml response
	*/
	xml(data, statusCode) {
		return this.setContentType("text/xml").send(data, statusCode);
	}
	/**
	* Send plain text response
	*/
	text(data, statusCode) {
		return this.setContentType("text/plain").send(data, statusCode);
	}
	/**
	* Create a streaming response for progressive/chunked data sending
	*
	* This method allows you to send data in chunks and control when the response ends.
	* Perfect for Server-Sent Events (SSE), progressive rendering, or streaming large responses.
	*
	* @example
	* ```ts
	* const stream = response.stream("text/html");
	* stream.send("<html><body>");
	* stream.send("<h1>Hello</h1>");
	* stream.render(<MyComponent />);
	* stream.send("</body></html>");
	* stream.end();
	* ```
	*
	* @param contentType - The content type for the stream (default: "text/plain")
	* @returns Stream controller with send(), render(), and end() methods
	*/
	stream(contentType = "text/plain") {
		this.setContentType(contentType);
		this.header("Transfer-Encoding", "chunked");
		this.header("Cache-Control", "no-cache");
		this.header("Connection", "keep-alive");
		this.header("X-Content-Type-Options", "nosniff");
		Response.trigger("sending", this);
		for (const callback of this.events.get("sending") || []) callback(this);
		this.log("Starting stream");
		let isEnded = false;
		const chunks = [];
		this.baseResponse.raw.writeHead(this.statusCode, this.getHeaders());
		return {
			/**
			* Send a chunk of data to the client
			* @param data - Data to send (string, Buffer, or any serializable data)
			*/
			send: (data) => {
				if (isEnded) throw new Error("Cannot send data: stream has already ended");
				this.baseResponse.raw.write(data);
				return this;
			},
			/**
			* Render a React component and send it as a chunk
			* @param element - React element or component to render
			*/
			render: (element) => {
				if (isEnded) throw new Error("Cannot render: stream has already ended");
				const html = renderReact(element);
				chunks.push(html);
				this.baseResponse.raw.write(html);
				return this;
			},
			/**
			* End the stream and trigger completion events
			*/
			end: () => {
				if (isEnded) return this;
				isEnded = true;
				this.currentBody = chunks;
				this.parsedBody = chunks;
				this.baseResponse.raw.end();
				this.log("Stream ended");
				Response.trigger("sent", this);
				for (const callback of this.events.get("sent") || []) callback(this);
				if (this.isOk) Response.trigger("success", this);
				if (this.currentStatusCode === 201) Response.trigger("successCreate", this);
				return this;
			},
			/**
			* Check if the stream has ended
			*/
			get ended() {
				return isEnded;
			}
		};
	}
	/**
	* Create a Server-Sent Events (SSE) stream
	*
	* SSE is a standard for pushing real-time updates from server to client.
	* Perfect for live notifications, progress updates, or real-time data feeds.
	*
	* @example
	* ```ts
	* const sse = response.sse();
	*
	* // Send events
	* sse.send("message", { text: "Hello!" });
	* sse.send("notification", { type: "info", message: "Update available" }, "msg-123");
	*
	* // Keep connection alive
	* const keepAlive = setInterval(() => sse.comment("ping"), 30000);
	*
	* // Clean up when done
	* clearInterval(keepAlive);
	* sse.end();
	* ```
	*
	* @returns SSE controller with send(), comment(), and end() methods
	*/
	sse() {
		this.setContentType("text/event-stream");
		this.header("Cache-Control", "no-cache, no-store, must-revalidate");
		this.header("Connection", "keep-alive");
		this.header("X-Accel-Buffering", "no");
		Response.trigger("sending", this);
		for (const callback of this.events.get("sending") || []) callback(this);
		this.log("Starting SSE stream");
		let isEnded = false;
		const events = [];
		const disconnectHandlers = [];
		this.baseResponse.raw.writeHead(this.statusCode, this.getHeaders());
		this.baseResponse.raw.on("close", () => {
			if (!isEnded) {
				isEnded = true;
				this.log("SSE client disconnected");
				for (const handler of disconnectHandlers) handler();
			}
		});
		const controller = {
			/**
			* Send an SSE event
			* @param event - Event name (e.g., "message", "chunk", "done")
			* @param data - Event data (will be JSON stringified)
			* @param id - Optional event ID for client-side Last-Event-ID tracking (reconnect support)
			*/
			send: (event, data, id) => {
				if (isEnded) return controller;
				let message = "";
				if (id) message += `id: ${id}\n`;
				message += `event: ${event}\n`;
				message += `data: ${JSON.stringify(data)}\n\n`;
				events.push({
					event,
					data,
					id
				});
				this.baseResponse.raw.write(message);
				return controller;
			},
			/**
			* Send a comment (keeps connection alive, invisible to client)
			* Useful for preventing timeout on long-lived connections
			* @param text - Comment text
			*/
			comment: (text) => {
				if (isEnded) return controller;
				this.baseResponse.raw.write(`: ${text}\n\n`);
				return controller;
			},
			/**
			* End the SSE stream and trigger completion events
			*/
			end: () => {
				if (isEnded) return controller;
				isEnded = true;
				this.currentBody = events;
				this.parsedBody = events;
				this.baseResponse.raw.end();
				this.log("SSE stream ended");
				Response.trigger("sent", this);
				for (const callback of this.events.get("sent") || []) callback(this);
				if (this.isOk) Response.trigger("success", this);
				return controller;
			},
			/**
			* Register a handler to be called when the client disconnects.
			* Use this to clean up EventEmitter listeners, cancel background jobs, etc.
			*
			* @example
			* ```ts
			* const sse = response.sse();
			* const listener = (chunk) => sse.send("chunk", { chunk });
			* eventBus.on(aiMessageId, listener);
			* sse.onDisconnect(() => eventBus.off(aiMessageId, listener));
			* ```
			*/
			onDisconnect: (handler) => {
				disconnectHandlers.push(handler);
				return controller;
			},
			/**
			* Check if the stream has ended (either via end() or client disconnect)
			*/
			get ended() {
				return isEnded;
			}
		};
		return controller;
	}
	/**
	* Set the status code
	*/
	setStatusCode(statusCode) {
		this.currentStatusCode = statusCode;
		return this;
	}
	/**
	* Redirect the user to another route
	*/
	redirect(url, statusCode = 302) {
		this.baseResponse.redirect(url, statusCode);
		return this;
	}
	/**
	* Permanent redirect
	*/
	permanentRedirect(url) {
		this.baseResponse.redirect(url, 301);
		return this;
	}
	/**
	* Get the response time
	*/
	getResponseTime() {
		return this.baseResponse.elapsedTime;
	}
	/**
	* Remove a specific header
	*/
	removeHeader(key) {
		this.baseResponse.removeHeader(key);
		return this;
	}
	/**
	* Get a specific header
	*/
	getHeader(key) {
		return this.baseResponse.getHeader(key);
	}
	/**
	* Get the response headers
	*/
	getHeaders() {
		return this.baseResponse.getHeaders();
	}
	/**
	* Set multiple headers
	*/
	headers(headers) {
		this.baseResponse.headers(headers);
		return this;
	}
	/**
	* Set the response header
	*/
	header(key, value) {
		this.baseResponse.header(key, value);
		return this;
	}
	/**
	* Set a cookie on the response.
	*
	* Values are JSON-stringified by default so structured cookies round-trip
	* cleanly with `request.cookie(name)`. Pass `{ raw: true }` to skip the
	* JSON wrapping for plain-string cookies (session tokens, opaque IDs).
	*
	* @example
	* // JSON-wrapped (default) — round-trips with request.cookie()
	* response.cookie("prefs", { theme: "dark" }, { maxAge: 3600, httpOnly: true });
	*
	* @example
	* // Raw string — no JSON quoting; useful for tokens / opaque IDs
	* response.cookie("session", "abc.def.ghi", { raw: true, httpOnly: true });
	*/
	cookie(name, value, options = {}) {
		const { raw, ...cookieOptions } = options;
		const defaultOptions = baseConfig.get("http.cookies.options", {});
		const serializedValue = raw ? String(value) : JSON.stringify(value);
		this.baseResponse.setCookie(name, serializedValue, {
			...defaultOptions,
			...cookieOptions
		});
		return this;
	}
	/**
	* Clear a cookie from the response
	*
	* @example
	* response.clearCookie('token', { path: '/' });
	*/
	clearCookie(name, options) {
		const defaultOptions = baseConfig.get("http.cookies.options", {});
		this.baseResponse.clearCookie(name, {
			...defaultOptions,
			...options
		});
		return this;
	}
	/**
	* Alias to header method
	*/
	setHeader(key, value) {
		return this.header(key, value);
	}
	/**
	* Send an error response with status code 500
	*/
	serverError(data) {
		return this.send(data, 500);
	}
	/**
	* Send a forbidden response with status code 403
	*/
	forbidden(data = { error: "You are not allowed to access this resource, FORBIDDEN" }) {
		return this.send(data, 403);
	}
	/**
	* Send a service unavailable response with status code 503
	*/
	serviceUnavailable(data) {
		return this.send(data, 503);
	}
	/**
	* Send an unauthorized response with status code 401
	*/
	unauthorized(data = { error: "unauthorized" }) {
		return this.send(data, 401);
	}
	/**
	* Send a not found response with status code 404
	*/
	notFound(data = { error: "notFound" }) {
		return this.send(data, 404);
	}
	/**
	* Send a bad request response with status code 400
	*/
	badRequest(data) {
		return this.send(data, 400);
	}
	/**
	* Send a content too large response with status code 413
	*/
	contentTooLarge(data) {
		return this.send(data, 413);
	}
	/**
	* Send a success response with status code 201
	*/
	successCreate(data) {
		return this.send(data, 201);
	}
	/**
	* Send a success response
	*/
	success(data = { success: true }) {
		return this.send(data);
	}
	/**
	* Send a no content response with status code 204
	*/
	noContent() {
		return this.baseResponse.status(204).send();
	}
	/**
	* Send an accepted response with status code 202
	* Used for async operations that have been accepted but not yet processed
	*/
	accepted(data = { message: "Request accepted for processing" }) {
		return this.send(data, 202);
	}
	/**
	* Send a conflict response with status code 409
	*/
	conflict(data = { error: "Resource conflict" }) {
		return this.send(data, 409);
	}
	/**
	* Send a too many requests response with status code 429
	*/
	tooManyRequests(data) {
		return this.send(data, 429);
	}
	/**
	* Send an unprocessable entity response with status code 422
	* Used for semantic validation errors
	*/
	unprocessableEntity(data) {
		return this.send(data, 422);
	}
	/**
	* Apply response options (cache, disposition, etag)
	* Shared helper for sendFile and sendBuffer
	*/
	applyResponseOptions(options, defaultFilename) {
		if (options.contentType) this.baseResponse.type(options.contentType);
		if (options.cacheTime) {
			const cacheControl = options.immutable ? `public, max-age=${options.cacheTime}, immutable` : `public, max-age=${options.cacheTime}`;
			this.header("Cache-Control", cacheControl);
			this.header("Expires", new Date(Date.now() + options.cacheTime * 1e3).toUTCString());
		}
		if (options.etag) {
			this.header("ETag", options.etag);
			const ifNoneMatch = this.request.header("if-none-match");
			if (ifNoneMatch && ifNoneMatch === options.etag) {
				this.log("Content not modified (ETag match), sending 304");
				this.baseResponse.status(304).send();
				return true;
			}
		}
		if (options.inline !== void 0 || options.filename) {
			const disposition = options.inline ? "inline" : "attachment";
			const filename = options.filename || defaultFilename || "file";
			this.header("Content-Disposition", `${disposition}; filename=\"${filename}\"`);
		}
		return false;
	}
	/**
	* Send a file as a response
	*/
	async sendFile(filePath, options) {
		if (filePath instanceof StorageFile) filePath = filePath.absolutePath;
		this.log(`Sending file: ${filePath}`);
		if (!await fileExistsAsync(filePath)) return this.notFound({ error: "File Not Found" });
		try {
			const opts = typeof options === "number" ? { cacheTime: options } : options || {};
			const stats = await fs.promises.stat(filePath);
			const lastModified = stats.mtime;
			const etag = `"${stats.size}-${stats.mtime.getTime()}"`;
			this.header("Last-Modified", lastModified.toUTCString());
			this.header("ETag", etag);
			const contentType = this.getFileContentType(filePath);
			this.baseResponse.type(contentType);
			const defaultFilename = path.basename(filePath);
			if (this.applyResponseOptions({
				...opts,
				etag,
				contentType
			}, defaultFilename)) return this.baseResponse;
			const ifNoneMatch = this.request.header("if-none-match");
			const ifModifiedSince = this.request.header("if-modified-since");
			if (ifNoneMatch && ifNoneMatch === etag) {
				this.log("File not modified (ETag match), sending 304");
				return this.baseResponse.status(304).send();
			}
			if (ifModifiedSince) {
				const modifiedSinceDate = new Date(ifModifiedSince);
				if (lastModified.getTime() <= modifiedSinceDate.getTime()) {
					this.log("File not modified (Last-Modified check), sending 304");
					return this.baseResponse.status(304).send();
				}
			}
			const stream = fs.createReadStream(filePath);
			stream.on("error", (error) => {
				this.log(`Error reading file: ${error.message}`, "error");
				if (!this.baseResponse.sent) this.serverError({
					error: "Error reading file",
					message: error.message
				});
			});
			return this.baseResponse.send(stream);
		} catch (error) {
			this.log(`Error sending file: ${error.message}`, "error");
			return this.serverError({
				error: "Error sending file",
				message: error.message
			});
		}
	}
	/**
	* Send buffer as a response
	* Useful for dynamically generated content (e.g., resized images, generated PDFs)
	*/
	sendBuffer(buffer, options) {
		this.log("Sending buffer");
		const opts = typeof options === "number" ? { cacheTime: options } : options || {};
		if (this.applyResponseOptions(opts)) return this.baseResponse;
		return this.baseResponse.send(buffer);
	}
	/**
	* Send an Image instance as a response
	* Automatically detects image format and sets content type
	*/
	async sendImage(image, options) {
		this.log("Sending image");
		const opts = typeof options === "number" ? { cacheTime: options } : options || {};
		const metadata = await image.metadata();
		const format = metadata.format || "jpeg";
		const buffer = await image.toBuffer();
		const contentType = opts.contentType || `image/${format}`;
		if (!opts.etag) opts.etag = `"${format}-${metadata.width || 0}x${metadata.height || 0}-${buffer.length}"`;
		if (this.applyResponseOptions({
			...opts,
			contentType
		})) return this.baseResponse;
		return this.baseResponse.send(buffer);
	}
	/**
	* Send file and cache it
	* Cache time in seconds
	* Cache time will be one year
	*/
	sendCachedFile(path, cacheTime = 31536e3) {
		return this.sendFile(path, cacheTime);
	}
	/**
	* Download the given file path
	*/
	download(path, filename) {
		return this.downloadFile(path, filename);
	}
	/**
	* Download the given file path
	*/
	async downloadFile(filePath, filename) {
		if (!await fileExistsAsync(filePath)) return this.notFound({ error: "File Not Found" });
		try {
			if (!filename) filename = path.basename(filePath);
			this.baseResponse.header("Content-Disposition", `attachment; filename="${filename}"`);
			this.baseResponse.header("Content-Type", "application/octet-stream");
			const stream = fs.createReadStream(filePath);
			stream.on("error", (error) => {
				this.log(`Error reading file for download: ${error.message}`, "error");
				if (!this.baseResponse.sent) this.serverError({
					error: "Error reading file",
					message: error.message
				});
			});
			return this.baseResponse.send(stream);
		} catch (error) {
			this.log(`Error downloading file: ${error.message}`, "error");
			return this.serverError({
				error: "Error downloading file",
				message: error.message
			});
		}
	}
	/**
	* Get content type of the given path
	*/
	getFileContentType(filePath) {
		return mime.getType(filePath) || "application/octet-stream";
	}
	/**
	* Mark the response as failed
	*/
	failedSchema(result) {
		const { errors, inputKey, inputError, status } = baseConfig.get("validation.response", {
			errors: "errors",
			inputKey: "input",
			inputError: "error",
			status: 400
		});
		log.error("request", "validation", `${this.request.id} - Validation failed`);
		return this.send({ [errors]: result.errors.map((error) => ({
			[inputKey]: error.input,
			[inputError]: error.error
		})) }, status);
	}
};
//#endregion
export { Response, ResponseStatus };

//# sourceMappingURL=response.mjs.map