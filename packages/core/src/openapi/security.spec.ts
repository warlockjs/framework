import { describe, expect, it, vi } from "vitest";
import {
  AUTH_DESCRIPTOR_SYMBOL,
  parseAuthDescriptor,
  readRouteAuth,
  SecuritySchemes,
} from "./security";

function middleware(required?: boolean) {
  const fn = () => required;
  Object.defineProperty(fn, AUTH_DESCRIPTOR_SYMBOL, {
    value: {
      sources: ["header"],
      userTypes: ["user"],
      ...(required === undefined ? {} : { required }),
    },
  });
  return fn;
}

describe("auth descriptor requirements", () => {
  it("keeps legacy guards required and distinguishes optional authentication", () => {
    const warn = vi.fn();
    expect(readRouteAuth([middleware()], warn)).toEqual({
      sources: ["header"],
      userTypes: ["user"],
    });
    expect(readRouteAuth([middleware(false)], warn)?.required).toBe(false);
    expect(readRouteAuth([middleware(false), middleware()], warn)?.required).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects malformed required flags", () => {
    expect(parseAuthDescriptor({ sources: ["header"], required: "false" })).toBeUndefined();
  });

  it("allows anonymous OpenAPI requests only for optional authentication", () => {
    const schemes = new SecuritySchemes();
    expect(
      schemes.requirementsFor({ sources: ["header"], userTypes: [], required: false }),
    ).toEqual([{ bearerAuth: [] }, {}]);
    expect(schemes.requirementsFor({ sources: ["header"], userTypes: [] })).toEqual([
      { bearerAuth: [] },
    ]);
  });
});
