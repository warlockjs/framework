import type { DevtoolsApiErrorBody, DevtoolsErrorCode } from "@contracts";
import { isConnectionFailure, reportFailure, reportSuccess } from "./connection";

/**
 * The dashboard's only way to call its API. Paths are relative to the
 * dashboard root (`"api/requests"`), so the same bundle works under
 * `/__warlock` and under a production path. Every POST/PUT/PATCH/DELETE
 * carries the session's CSRF token; every call is same-origin and uncached.
 */

/** A failed call: the server's message (what failed and what to do next), its code and reference. */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: DevtoolsErrorCode | null;
  public readonly ref: string | null;
  public readonly instance: string | null;

  public constructor(message: string, status: number, body: Partial<DevtoolsApiErrorBody> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? null;
    this.ref = body.ref ?? null;
    this.instance = body.instance ?? null;
  }
}

/** Fired on `window` when an API call answers a bare 404: in production that means the session ended. */
export const NOT_FOUND_EVENT = "devtools:not-found";

let csrfToken: string | null = null;

/** Sets the token sent as `X-Devtools-Csrf` (from `api/auth/session` or a sign-in step). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** The current CSRF token, for package panel views. */
export function getCsrfToken(): string | null {
  return csrfToken;
}

/** A dashboard-relative path as a URL string (leading slashes dropped). */
export function apiUrl(path: string): string {
  return path.replace(/^\/+/, "");
}

export type ApiRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  signal?: AbortSignal;
};

const UNREACHABLE = "Could not reach the server. Check your connection and try again.";
const NOT_FOUND =
  "This view is not available: your session may have ended or the dashboard was turned off. Reload the page.";

/** Calls the API and returns the parsed JSON (`undefined` for 204). Throws `ApiError`. */
export async function apiFetch<T>(path: string, request: ApiRequest = {}): Promise<T> {
  const method = request.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };

  if (request.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-Devtools-Csrf"] = csrfToken;

  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;

    reportFailure();

    throw new ApiError(UNREACHABLE, 0);
  }

  if (isConnectionFailure(response.status)) reportFailure();
  else reportSuccess();

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    let body: Partial<DevtoolsApiErrorBody> = {};

    try {
      body = (await response.json()) as Partial<DevtoolsApiErrorBody>;
    } catch {
      // A bare 404 (the uniform not-found answer) has no JSON body.
    }

    if (response.status === 404 && body.code === undefined && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(NOT_FOUND_EVENT, { detail: { path } }));
    }

    const message =
      typeof body.error === "string" && body.error
        ? body.error
        : response.status === 404
          ? NOT_FOUND
          : `The server answered ${response.status}. Try again; if it keeps failing, check the server log.`;

    throw new ApiError(message, response.status, body);
  }

  return (await response.json()) as T;
}
