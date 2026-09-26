import { describe, expect, it, vi } from "vitest";
import type { Request } from "../request";
import type { Response } from "../response";
import { rateLimitMiddleware } from "./rate-limit.middleware";

let seq = 0;

function run(middleware: ReturnType<typeof rateLimitMiddleware>, path: string, userId?: string, ip = "1.1.1.1") {
  const request = {
    route: { path },
    locals: userId ? { user: { id: userId } } : {},
    detectIp: () => ip,
  } as unknown as Request;
  const response = {
    header: vi.fn(),
    tooManyRequests: vi.fn(() => "429"),
  } as unknown as Response;

  const result = (middleware as any)({ request, response });

  return { result, response };
}

describe("rateLimitMiddleware key: user", () => {
  it("separates two users", () => {
    const path = `/u${seq++}`;
    const mw = rateLimitMiddleware({ max: 1, duration: 60_000, key: "user" });

    expect(run(mw, path, "a").response.tooManyRequests).not.toHaveBeenCalled();
    expect(run(mw, path, "a").response.tooManyRequests).toHaveBeenCalled();
    expect(run(mw, path, "b").response.tooManyRequests).not.toHaveBeenCalled();
  });

  it("falls back to IP for guests by default", () => {
    const path = `/u${seq++}`;
    const mw = rateLimitMiddleware({ max: 1, duration: 60_000, key: "user" });

    run(mw, path, undefined, "9.9.9.9");

    expect(run(mw, path, undefined, "9.9.9.9").response.tooManyRequests).toHaveBeenCalled();
    expect(run(mw, path, undefined, "8.8.8.8").response.tooManyRequests).not.toHaveBeenCalled();
  });

  it("skips guests when guests is skip", () => {
    const path = `/u${seq++}`;
    const mw = rateLimitMiddleware({ max: 1, duration: 60_000, key: "user", guests: "skip" });

    for (let i = 0; i < 3; i++) {
      const { response } = run(mw, path);
      expect(response.tooManyRequests).not.toHaveBeenCalled();
      expect(response.header).not.toHaveBeenCalled();
    }
  });

  it("sets X-RateLimit headers", () => {
    const mw = rateLimitMiddleware({ max: 5, duration: 60_000, key: "user" });
    const { response } = run(mw, `/u${seq++}`, "a");

    expect(response.header).toHaveBeenCalledWith("X-RateLimit-Limit", 5);
    expect(response.header).toHaveBeenCalledWith("X-RateLimit-Remaining", 4);
    expect(response.header).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(Number));
  });
});
