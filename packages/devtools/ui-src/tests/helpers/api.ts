import { vi } from "vitest";
import type { DevtoolsAccountView, DevtoolsSessionView } from "@contracts";
import { setCsrfToken } from "@/api/client";

export type MockRequest = {
  url: string;
  path: string;
  method: string;
  body: unknown;
  headers: Headers;
};

export type MockAnswer = { status?: number; body?: unknown };
export type MockHandler = MockAnswer | ((request: MockRequest) => MockAnswer | Promise<MockAnswer>);

/**
 * Stubs `fetch`. Routes are keyed `"METHOD path"` (path without the query) or
 * just `"path"` for GET. A route may be an answer or a function of the request.
 * Unmocked calls answer 599 with a message naming the call, and are listed in `calls`.
 */
export function mockApi(routes: Record<string, MockHandler>) {
  const calls: MockRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const path = url.split("?")[0] ?? url;
    const request: MockRequest = {
      url,
      path,
      method,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      headers: new Headers(init.headers),
    };

    calls.push(request);

    const handler =
      routes[`${method} ${url}`] ??
      routes[`${method} ${path}`] ??
      (method === "GET" ? (routes[url] ?? routes[path]) : undefined);

    if (handler === undefined) {
      return new Response(
        JSON.stringify({ error: `unmocked ${method} ${url}`, code: "server.error" }),
        {
          status: 599,
        },
      );
    }

    const answer = typeof handler === "function" ? await handler(request) : handler;
    const status = answer.status ?? 200;

    if (status === 204 || answer.body === undefined)
      return new Response(null, { status: status === 200 ? 204 : status });

    return new Response(JSON.stringify(answer.body), { status });
  });

  vi.stubGlobal("fetch", fetchMock);
  setCsrfToken(null);

  return { fetchMock, calls };
}

export const instanceInfo = {
  id: "host:1:abc",
  label: "host #1",
  host: "host",
  pid: 1,
  worker: "1",
  startedAt: 1,
  seenAt: 2,
  nodeVersion: "v22",
};

export function account(overrides: Partial<DevtoolsAccountView> = {}): DevtoolsAccountView {
  return {
    id: "a1",
    email: "admin@example.com",
    role: "admin",
    twoFactor: { totp: true, passkeys: [], recoveryCodesLeft: 8 },
    mustChangePassword: false,
    createdAt: 1,
    lastLoginAt: 2,
    ...overrides,
  };
}

export function sessionView(overrides: Partial<DevtoolsSessionView> = {}): DevtoolsSessionView {
  return {
    mode: "production",
    stage: "active",
    account: account(),
    role: "admin",
    csrf: "csrf-1",
    expiresAt: 9_999_999_999_999,
    instance: instanceInfo,
    methods: { totp: true, passkeys: false },
    ...overrides,
  };
}

export const signedOut: DevtoolsSessionView = {
  mode: "production",
  stage: "signed-out",
  account: null,
  role: null,
  csrf: null,
  expiresAt: null,
  instance: null,
  methods: null,
};

export const developmentSession = sessionView({
  mode: "development",
  account: null,
  role: "admin",
  csrf: null,
  expiresAt: null,
  methods: null,
});
