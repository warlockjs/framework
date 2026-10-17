/**
 * Warlock.js Test Helpers
 *
 * Utilities for testing Warlock.js applications.
 */

import { config } from "../config";
import { getHttpReadyReport } from "../http/ready-report";
import { TEST_SERVER_PORT_ENV_KEY } from "./test-server-port-channel";

/**
 * Get the test server base URL
 */
export function getTestServerUrl(): string {
  // `startHttpTestServer` publishes the port it actually bound. Test workers are
  // separate processes whose own config resolves `http.port` from `.env`, so
  // without this a suite started on an explicit port would send every request to
  // the `.env` port instead of the one the server is listening on.
  const publishedPort = process.env[TEST_SERVER_PORT_ENV_KEY];

  // Same-process fallback: a test that boots the HTTP connector directly
  // (rather than through `startHttpTestServer`'s cross-process channel) never
  // writes `TEST_SERVER_PORT_ENV_KEY`, so without this the next fallback —
  // `config.key("http.port", 2031)` — was the only source left, and it holds
  // the CONFIGURED port, not the bound one. For `http.port: 0` that is `0`,
  // producing `http://host:0` even though `HttpConnector.start()` had already
  // recorded the real bound port right here in `ready-report.ts`.
  const boundPort = getHttpReadyReport()?.port;

  // `config.key`'s default only substitutes for `undefined` — `0` is a
  // defined configured value, not an absent one — so it cannot be trusted to
  // paper over an unresolved port 0 either. `boundPort` is read first for
  // that exact reason.
  const port = publishedPort || boundPort || config.key("http.port", 2031);
  const host = config.key("http.host", "localhost");
  return `http://${host}:${port}`;
}

/**
 * Simple HTTP request helper for test server
 * Uses native fetch - lightweight, no extra dependencies
 */
export async function testRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return sendRequest(getTestServerUrl(), path, options, false);
}

/**
 * The single place a request is actually built.
 *
 * `serializedJson` says whether THIS module turned the caller's value into a
 * JSON string. It is the only thing that justifies setting a JSON content type:
 * a `FormData` body carries a multipart boundary the runtime generates, and
 * labelling it `application/json` produces a request no server can parse.
 */
async function sendRequest(
  baseUrl: string,
  path: string,
  options: RequestInit,
  serializedJson: boolean,
): Promise<Response> {
  const url = path.startsWith("/") ? `${baseUrl}${path}` : `${baseUrl}/${path}`;

  // Normalised through `Headers` rather than object-spread: `RequestInit.headers`
  // may be a record, a `Headers` instance, or a list of `[name, value]` tuples,
  // and spreading the last two silently produces an object with numeric keys —
  // the header is simply lost, with no error anywhere.
  const headers = new Headers(options.headers);

  if (serializedJson && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return fetch(url, { ...options, headers });
}

/**
 * Serialize a body for a JSON request.
 *
 * `undefined` means the caller omitted the argument; every other value —
 * including `false`, `0`, `""` and `null` — is a legal JSON document and must
 * be sent. The old check was `body ? JSON.stringify(body) : undefined`, which
 * dropped all four.
 */
function jsonBody(body: unknown): string | undefined {
  return body === undefined ? undefined : JSON.stringify(body);
}

/** The request helpers, bound to one server. */
export type TestRequestClient = {
  request(path: string, options?: RequestInit): Promise<Response>;
  get(path: string, options?: RequestInit): Promise<Response>;
  post(path: string, body?: unknown, options?: RequestInit): Promise<Response>;
  put(path: string, body?: unknown, options?: RequestInit): Promise<Response>;
  patch(path: string, body?: unknown, options?: RequestInit): Promise<Response>;
  delete(path: string, options?: RequestInit): Promise<Response>;
};

/**
 * Request helpers bound to `baseUrl` (a string, or a function read on every
 * request). `testGet()` and friends are this, bound to the shared test server;
 * `createTestHttpServer()` returns one bound to its own port.
 *
 * @example
 * const client = createTestRequestClient("http://127.0.0.1:4100");
 * await client.post("/posts", { title: "Hello" });
 */
export function createTestRequestClient(baseUrl: string | (() => string)): TestRequestClient {
  const base = () => (typeof baseUrl === "function" ? baseUrl() : baseUrl);
  const send = (method: string, path: string, body: unknown, options: RequestInit = {}) =>
    sendRequest(base(), path, { ...options, method, body: jsonBody(body) }, body !== undefined);

  return {
    request: (path, options = {}) => sendRequest(base(), path, options, false),
    get: (path, options = {}) => sendRequest(base(), path, { ...options, method: "GET" }, false),
    post: (path, body, options) => send("POST", path, body, options),
    put: (path, body, options) => send("PUT", path, body, options),
    patch: (path, body, options) => send("PATCH", path, body, options),
    delete: (path, options = {}) =>
      sendRequest(base(), path, { ...options, method: "DELETE" }, false),
  };
}

const sharedServer = createTestRequestClient(getTestServerUrl);

/**
 * GET request helper
 */
export async function testGet(path: string, options: RequestInit = {}): Promise<Response> {
  return sharedServer.get(path, options);
}

/**
 * POST request helper
 */
export async function testPost(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<Response> {
  return sharedServer.post(path, body, options);
}

/**
 * PUT request helper
 */
export async function testPut(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<Response> {
  return sharedServer.put(path, body, options);
}

/**
 * DELETE request helper
 */
export async function testDelete(path: string, options: RequestInit = {}): Promise<Response> {
  return sharedServer.delete(path, options);
}

/**
 * PATCH request helper
 */
export async function testPatch(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<Response> {
  return sharedServer.patch(path, body, options);
}

/**
 * Parse JSON response with type safety
 */
export async function parseJsonResponse<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/**
 * Assert response status and return parsed JSON
 */
export async function expectJson<T>(response: Response, expectedStatus = 200): Promise<T> {
  if (response.status !== expectedStatus) {
    const text = await response.text();
    throw new Error(`Expected status ${expectedStatus}, got ${response.status}. Body: ${text}`);
  }
  return parseJsonResponse<T>(response);
}
