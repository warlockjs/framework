import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the maintenance middleware focused on the allowlist
 * matching. `request.path` returns the raw URL (query string included), so the
 * middleware must strip the query before matching exact allowlist entries —
 * otherwise "/webhooks/stripe?sig=..." never matches "/webhooks/stripe".
 *
 * We mock `@mongez/config` (to flip maintenance on + seed the allowlist) and
 * the `t` translator helper so the middleware can run without booting the app
 * context.
 */
const configStore: Record<string, unknown> = {};

vi.mock("@mongez/config", () => ({
  default: {
    get: (key: string, fallback?: unknown) =>
      key in configStore ? configStore[key] : fallback,
  },
}));

vi.mock("../../../src/http/middleware/inject-request-context", () => ({
  t: (keyword: string) => keyword,
}));

type FakeResponse = {
  header: ReturnType<typeof vi.fn>;
  serviceUnavailable: ReturnType<typeof vi.fn>;
};

function makeResponse(): FakeResponse {
  const response: FakeResponse = {
    header: vi.fn(() => response),
    serviceUnavailable: vi.fn(() => "SERVICE_UNAVAILABLE"),
  };

  return response;
}

function makeRequest(path: string) {
  return { path } as never;
}

describe("maintenanceMiddleware", () => {
  let maintenanceMiddleware: typeof import("../../../src/http/middleware/maintenance.middleware").maintenanceMiddleware;

  beforeEach(async () => {
    for (const key of Object.keys(configStore)) {
      delete configStore[key];
    }
    ({ maintenanceMiddleware } = await import(
      "../../../src/http/middleware/maintenance.middleware"
    ));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes through when maintenance is disabled", () => {
    configStore["http.maintenance.enabled"] = false;

    const middleware = maintenanceMiddleware();
    const response = makeResponse();

    const result = middleware(makeRequest("/anything"), response as never);

    expect(result).toBeUndefined();
    expect(response.serviceUnavailable).not.toHaveBeenCalled();
  });

  it("503s a non-allowlisted path when maintenance is enabled", () => {
    configStore["http.maintenance.enabled"] = true;

    const middleware = maintenanceMiddleware({ allowlist: ["/health"] });
    const response = makeResponse();

    middleware(makeRequest("/api/orders"), response as never);

    expect(response.serviceUnavailable).toHaveBeenCalledTimes(1);
  });

  it("allowlists an exact path even when it carries a query string", () => {
    configStore["http.maintenance.enabled"] = true;

    const middleware = maintenanceMiddleware({ allowlist: ["/webhooks/stripe"] });
    const response = makeResponse();

    const result = middleware(
      makeRequest("/webhooks/stripe?sig=abc&t=123"),
      response as never,
    );

    expect(result).toBeUndefined();
    expect(response.serviceUnavailable).not.toHaveBeenCalled();
  });

  it("still matches a prefix allowlist entry after stripping the query", () => {
    configStore["http.maintenance.enabled"] = true;

    const middleware = maintenanceMiddleware({ allowlist: ["/admin/*"] });
    const response = makeResponse();

    const result = middleware(
      makeRequest("/admin/users?page=2"),
      response as never,
    );

    expect(result).toBeUndefined();
    expect(response.serviceUnavailable).not.toHaveBeenCalled();
  });
});
