/**
 * Warlock.js Test Helpers
 *
 * Utilities for testing Warlock.js applications.
 */

import { config } from "../config";
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
  const port = publishedPort || config.key("http.port", 2031);
  const host = config.key("http.host", "localhost");
  return `http://${host}:${port}`;
}

/**
 * Simple HTTP request helper for test server
 * Uses native fetch - lightweight, no extra dependencies
 */
export async function testRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return sendRequest(path, options, false);
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
  path: string,
  options: RequestInit,
  serializedJson: boolean,
): Promise<Response> {
  const baseUrl = getTestServerUrl();
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

/**
 * GET request helper
 */
export async function testGet(path: string, options: RequestInit = {}): Promise<Response> {
  return testRequest(path, { ...options, method: "GET" });
}

/**
 * POST request helper
 */
export async function testPost(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<Response> {
  return sendRequest(path, { ...options, method: "POST", body: jsonBody(body) }, body !== undefined);
}

/**
 * PUT request helper
 */
export async function testPut(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<Response> {
  return sendRequest(path, { ...options, method: "PUT", body: jsonBody(body) }, body !== undefined);
}

/**
 * DELETE request helper
 */
export async function testDelete(path: string, options: RequestInit = {}): Promise<Response> {
  return testRequest(path, { ...options, method: "DELETE" });
}

/**
 * PATCH request helper
 */
export async function testPatch(
  path: string,
  body?: unknown,
  options: RequestInit = {},
): Promise<Response> {
  return sendRequest(path, { ...options, method: "PATCH", body: jsonBody(body) }, body !== undefined);
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
