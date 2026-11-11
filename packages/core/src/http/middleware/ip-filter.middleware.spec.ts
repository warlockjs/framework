import { describe, expect, it, vi } from "vitest";
import type { Request } from "../request";
import type { Response } from "../response";
import { ipFilterMiddleware } from "./ip-filter.middleware";

function run(middleware: ReturnType<typeof ipFilterMiddleware>, ip: string) {
  const request = { detectIp: () => ip } as unknown as Request;
  const response = { forbidden: vi.fn(() => "403") } as unknown as Response;

  (middleware as any)({ request, response });

  return response.forbidden as ReturnType<typeof vi.fn>;
}

describe("ipFilter with IPv6", () => {
  it("denies an address inside an IPv6 block", () => {
    const mw = ipFilterMiddleware({ deny: ["2001:db8::/32"], errorMessage: "no" });

    expect(run(mw, "2001:db8::5")).toHaveBeenCalled();
    expect(run(mw, "2001:db9::5")).not.toHaveBeenCalled();
  });

  it("compares IPv6 addresses by value, not by spelling", () => {
    const mw = ipFilterMiddleware({ deny: ["2001:db8::1"], errorMessage: "no" });

    expect(run(mw, "2001:0db8:0000::1")).toHaveBeenCalled();
  });

  it("matches IPv4-mapped IPv6 clients against IPv4 blocks", () => {
    const mw = ipFilterMiddleware({ allow: ["10.0.0.0/8"], errorMessage: "no" });

    expect(run(mw, "::ffff:10.1.2.3")).not.toHaveBeenCalled();
    expect(run(mw, "::ffff:11.1.2.3")).toHaveBeenCalled();
  });
});

describe("ipFilter pattern validation", () => {
  it("throws when the middleware is created with an unparsable pattern", () => {
    expect(() => ipFilterMiddleware({ allow: ["not-an-ip"] })).toThrow(/ipFilter allow/);
    expect(() => ipFilterMiddleware({ deny: ["10.0.0.0/33"] })).toThrow(/ipFilter deny/);
    expect(() => ipFilterMiddleware({ deny: ["2001:db8::/129"] })).toThrow(/not an IP address/);
  });

  it("keeps IPv4 exact and CIDR matching", () => {
    const mw = ipFilterMiddleware({ allow: ["192.168.0.0/16", "203.0.113.7"], errorMessage: "no" });

    expect(run(mw, "192.168.4.4")).not.toHaveBeenCalled();
    expect(run(mw, "203.0.113.7")).not.toHaveBeenCalled();
    expect(run(mw, "203.0.113.8")).toHaveBeenCalled();
  });
});
