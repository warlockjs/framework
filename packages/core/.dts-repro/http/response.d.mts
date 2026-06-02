import { StorageFile } from "../storage/storage-file.mjs";
import { Request } from "./request.mjs";
import { ResponseEvent, ResponseSSEController, ResponseStreamController } from "./types.mjs";
import { Route } from "../router/types.mjs";
import { ValidationResult } from "@warlock.js/seal";
import { LogLevel } from "@warlock.js/logger";
import { EventSubscription } from "@mongez/events";
import { FastifyReply } from "fastify";
import { CookieSerializeOptions } from "@fastify/cookie";
import React from "react";

//#region ../../@warlock.js/core/src/http/response.d.ts
type CookieValue = string | number | boolean | Record<string, any> | Array<any>;
/**
 * Cookie options accepted by `response.cookie()`.
 *
 * Extends Fastify's `CookieSerializeOptions` with `raw` — set to `true` to
 * skip the default `JSON.stringify` of the value and write it as-is. Use for
 * plain-string cookies (session tokens, opaque IDs) that shouldn't be JSON-quoted.
 *
 * When `raw: true`, non-string values are coerced via `String(value)`. The
 * read side (`request.cookie(name)`) tries `JSON.parse` first and falls back
 * to the raw string on parse failure, so round-tripping a raw string cookie
 * Just Works.
 */
type CookieOptions = CookieSerializeOptions & {
  /**
   * Skip JSON.stringify and write the value as-is.
   *
   * @default false
   */
  raw?: boolean;
};
declare enum ResponseStatus {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  MOVED_PERMANENTLY = 301,
  FOUND = 302,
  SEE_OTHER = 303,
  NOT_MODIFIED = 304,
  TEMPORARY_REDIRECT = 307,
  PERMANENT_REDIRECT = 308,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  CONFLICT = 409,
  TOO_MANY_REQUESTS = 429,
  INTERNAL_SERVER_ERROR = 500,
  SERVICE_UNAVAILABLE = 503
}
/**
 * Options for sending files
 */
type SendFileOptions = {
  cacheTime?: number;
  immutable?: boolean;
  inline?: boolean;
  filename?: string;
};
/**
 * Options for sending buffers
 */
type SendBufferOptions = SendFileOptions & {
  contentType?: string;
  etag?: string;
};
declare class Response {
  /**
   * Current route
   */
  protected route: Route;
  /**
   * Underlying Fastify reply — a public escape hatch to capabilities the
   * framework's high-level helpers don't yet cover.
   *
   * **Prefer framework methods first**: `response.send()`, `response.header()`,
   * `response.cookie()`, `response.sendFile()`, `response.stream()`, etc.
   * They wire status codes, content-type detection, the event lifecycle, and
   * the cache-pattern replay path correctly.
   *
   * **Reach for `baseResponse` only** when the framework genuinely lacks a
   * helper for what you need — and when you do, file an issue so we can add
   * it. Streaming and SSE are the precedent here: they bypass `send()`
   * deliberately because the framework didn't ship chunked-write support
   * natively at the time. Reaching here for non-streaming work means a
   * missing helper, not an answer.
   */
  baseResponse: FastifyReply;
  /**
   * Current status code
   */
  protected currentStatusCode: number;
  /**
   * Current response body
   */
  protected currentBody: any;
  /**
   * Request object
   */
  request: Request;
  /**
   * Internal events related to this particular response object
   */
  protected events: Map<string, any[]>;
  /**
   * Parsed body
   * This will return the parsed body of the response
   * Please note that if this property is called before the response is sent, it will return undefined
   */
  parsedBody: any;
  /**
   * Get raw response
   */
  get raw(): import("http").ServerResponse<import("http").IncomingMessage>;
  /**
   * Get Current response body
   */
  get body(): any;
  /**
   * Set response body
   */
  set body(body: any);
  /**
   * Add event on sending response
   */
  onSending(callback: any): this;
  /**
   * Add event on sent response
   */
  onSent(callback: any): this;
  /**
   * Set the Fastify response object
   */
  setResponse(response: FastifyReply): this;
  /**
   * Reset the response state
   */
  reset(): void;
  /**
   * Set current route
   */
  setRoute(route: Route): this;
  /**
   * Get the content type
   */
  get contentType(): string | number | string[] | undefined;
  /**
   * Set the content type
   */
  setContentType(contentType: string): this;
  /**
   * Get the status code
   */
  get statusCode(): number;
  /**
   * Check if response status is ok
   */
  get isOk(): boolean;
  /**
   * Check if the response has been sent
   */
  get sent(): boolean;
  /**
   * Add a listener to the response event
   */
  static on(event: ResponseEvent, listener: (response: Response) => void): EventSubscription;
  /**
   * Trigger the response event
   */
  protected static trigger(event: ResponseEvent, ...args: any[]): Promise<unknown>;
  /**
   * Parse body
   */
  protected parseBody(): Promise<any>;
  /**
   * Parse the given value
   */
  parse(value: any): Promise<any>;
  /**
   * Make a log message
   */
  log(message: string, level?: LogLevel): void;
  /**
   * Check if returning response is json
   */
  get isJson(): boolean;
  /**
   * Send the response
   * @param data - Response data
   * @param statusCode - HTTP status code
   * @param triggerEvents - Whether to trigger response events (default: true)
   */
  send(data?: any, statusCode?: number, triggerEvents?: boolean): Promise<Response>;
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
  replay(cached: {
    status: number;
    body: unknown;
    contentType?: string;
    headers?: Record<string, string>;
  }): Promise<Response>;
  /**
   * Send html response
   */
  html(data: string, statusCode?: number): Promise<Response>;
  /**
   * Render the given react component
   */
  render(element: React.ReactElement | React.ComponentType, status?: number): Promise<Response>;
  /**
   * Send xml response
   */
  xml(data: string, statusCode?: number): Promise<Response>;
  /**
   * Send plain text response
   */
  text(data: string, statusCode?: number): Promise<Response>;
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
  stream(contentType?: string): ResponseStreamController;
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
  sse(): ResponseSSEController;
  /**
   * Set the status code
   */
  setStatusCode(statusCode: number): this;
  /**
   * Redirect the user to another route
   */
  redirect(url: string, statusCode?: number): this;
  /**
   * Permanent redirect
   */
  permanentRedirect(url: string): this;
  /**
   * Get the response time
   */
  getResponseTime(): number;
  /**
   * Remove a specific header
   */
  removeHeader(key: string): this;
  /**
   * Get a specific header
   */
  getHeader(key: string): string | number | string[] | undefined;
  /**
   * Get the response headers
   */
  getHeaders(): Record<import("fastify/types/utils").HttpHeader, string | number | string[] | undefined>;
  /**
   * Set multiple headers
   */
  headers(headers: Record<string, string>): this;
  /**
   * Set the response header
   */
  header(key: string, value: any): this;
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
  cookie(name: string, value: CookieValue, options?: CookieOptions): this;
  /**
   * Clear a cookie from the response
   *
   * @example
   * response.clearCookie('token', { path: '/' });
   */
  clearCookie(name: string, options?: CookieSerializeOptions): this;
  /**
   * Alias to header method
   */
  setHeader(key: string, value: any): this;
  /**
   * Send an error response with status code 500
   */
  serverError(data: any): Promise<Response>;
  /**
   * Send a forbidden response with status code 403
   */
  forbidden(data?: any): Promise<Response>;
  /**
   * Send a service unavailable response with status code 503
   */
  serviceUnavailable(data: any): Promise<Response>;
  /**
   * Send an unauthorized response with status code 401
   */
  unauthorized(data?: any): Promise<Response>;
  /**
   * Send a not found response with status code 404
   */
  notFound(data?: any): Promise<Response>;
  /**
   * Send a bad request response with status code 400
   */
  badRequest(data: any): Promise<Response>;
  /**
   * Send a content too large response with status code 413
   */
  contentTooLarge(data: any): Promise<Response>;
  /**
   * Send a success response with status code 201
   */
  successCreate(data: any): Promise<Response>;
  /**
   * Send a success response
   */
  success(data?: any): Promise<Response>;
  /**
   * Send a no content response with status code 204
   */
  noContent(): FastifyReply<import("fastify").RouteGenericInterface, import("fastify").RawServerDefault, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, unknown, import("fastify").FastifySchema, import("fastify").FastifyTypeProviderDefault, unknown>;
  /**
   * Send an accepted response with status code 202
   * Used for async operations that have been accepted but not yet processed
   */
  accepted(data?: any): Promise<Response>;
  /**
   * Send a conflict response with status code 409
   */
  conflict(data?: any): Promise<Response>;
  /**
   * Send a too many requests response with status code 429
   */
  tooManyRequests(data: any): Promise<Response>;
  /**
   * Send an unprocessable entity response with status code 422
   * Used for semantic validation errors
   */
  unprocessableEntity(data: any): Promise<Response>;
  /**
   * Apply response options (cache, disposition, etag)
   * Shared helper for sendFile and sendBuffer
   */
  private applyResponseOptions;
  /**
   * Send a file as a response
   */
  sendFile(filePath: string | StorageFile, options?: number | SendFileOptions): Promise<Response>;
  /**
   * Send buffer as a response
   * Useful for dynamically generated content (e.g., resized images, generated PDFs)
   */
  sendBuffer(buffer: Buffer, options?: number | SendBufferOptions): FastifyReply<import("fastify").RouteGenericInterface, import("fastify").RawServerDefault, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, unknown, import("fastify").FastifySchema, import("fastify").FastifyTypeProviderDefault, unknown>;
  /**
   * Send an Image instance as a response
   * Automatically detects image format and sets content type
   */
  sendImage(image: any, // Type as 'any' to avoid circular dependency with Image class
  options?: number | (Omit<SendBufferOptions, "contentType"> & {
    contentType?: string;
  })): Promise<never>;
  /**
   * Send file and cache it
   * Cache time in seconds
   * Cache time will be one year
   */
  sendCachedFile(path: string | StorageFile, cacheTime?: number): Promise<Response>;
  /**
   * Download the given file path
   */
  download(path: string, filename?: string): Promise<Response>;
  /**
   * Download the given file path
   */
  downloadFile(filePath: string, filename?: string): Promise<Response>;
  /**
   * Get content type of the given path
   */
  getFileContentType(filePath: string): string;
  /**
   * Mark the response as failed
   */
  failedSchema(result: ValidationResult): Promise<Response>;
}
//#endregion
export { CookieOptions, Response, ResponseStatus, SendBufferOptions, SendFileOptions };
//# sourceMappingURL=response.d.mts.map