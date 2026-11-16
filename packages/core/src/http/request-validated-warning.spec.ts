import { log } from "@warlock.js/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvironment, environment } from "../utils/environment";
import { Request } from "./request";

let sequence = 0;

function requestOn(route: Record<string, unknown>) {
  const request = new Request();

  request.setRequest({
    method: "POST",
    url: "/hook",
    headers: {},
    body: undefined,
    query: {},
    params: {},
  } as never);
  request.route = { method: "POST", path: `/hook-${sequence++}`, ...route } as never;

  return request;
}

describe("request.validated() on a route with no schema", () => {
  const previous = environment();

  beforeEach(() => setEnvironment("development"));

  afterEach(() => {
    setEnvironment(previous);
    vi.restoreAllMocks();
  });

  it("returns {} and warns once per route in development", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => log);
    const request = requestOn({});

    expect(request.validated()).toEqual({});
    expect(request.validated()).toEqual({});

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "request",
      "validated",
      expect.stringContaining("request.input() / request.all()"),
    );
  });

  it("does not warn when the route has a validation schema", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => log);
    const request = requestOn({ handler: { validation: { schema: {} } } });

    request.validated();

    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent outside development", () => {
    setEnvironment("production");
    const warn = vi.spyOn(log, "warn").mockImplementation(() => log);

    requestOn({}).validated();

    expect(warn).not.toHaveBeenCalled();
  });
});
