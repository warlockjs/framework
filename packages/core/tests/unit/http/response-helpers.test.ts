import { describe, expect, it } from "vitest";
import { Response, ResponseStatus } from "../../../src/http/response";

/**
 * These tests cover only the parts of `Response` that don't touch the Fastify
 * reply: the `parse()` body transformer, the status-code getters/setters, and
 * `reset()`. Everything that calls `send()` needs a live reply and is left to
 * HTTP integration tests.
 */
describe("Response — parse()", () => {
  it("returns scalars unchanged", async () => {
    const response = new Response();

    expect(await response.parse("plain")).toBe("plain");
    expect(await response.parse(42)).toBe(42);
    expect(await response.parse(true)).toBe(true);
  });

  it("returns null/undefined unchanged", async () => {
    const response = new Response();

    expect(await response.parse(null)).toBeNull();
    expect(await response.parse(undefined)).toBeUndefined();
  });

  it("invokes toJSON() on objects that define it", async () => {
    const response = new Response();

    const value = {
      toJSON() {
        return { serialized: true };
      },
    };

    expect(await response.parse(value)).toEqual({ serialized: true });
  });

  it("awaits an async toJSON()", async () => {
    const response = new Response();

    const value = {
      async toJSON() {
        return { async: true };
      },
    };

    expect(await response.parse(value)).toEqual({ async: true });
  });

  it("recurses into nested plain objects", async () => {
    const response = new Response();

    const value = {
      top: "value",
      child: {
        toJSON() {
          return { nested: 1 };
        },
      },
    };

    expect(await response.parse(value)).toEqual({ top: "value", child: { nested: 1 } });
  });

  it("maps over arrays, parsing each item", async () => {
    const response = new Response();

    const value = [
      { toJSON: () => ({ a: 1 }) },
      { toJSON: () => ({ b: 2 }) },
    ];

    expect(await response.parse(value)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe("Response — status code", () => {
  it("defaults the status code to 200", () => {
    const response = new Response();

    expect(response.statusCode).toBe(200);
  });

  it("setStatusCode() updates the current status code and chains", () => {
    const response = new Response();

    const returned = response.setStatusCode(404);

    expect(returned).toBe(response);
    expect(response.statusCode).toBe(404);
  });

  it("isOk is true across the whole 2xx range", () => {
    const response = new Response();

    response.setStatusCode(200);
    expect(response.isOk).toBe(true);

    response.setStatusCode(204);
    expect(response.isOk).toBe(true);

    response.setStatusCode(299);
    expect(response.isOk).toBe(true);
  });

  it("isOk is false below 200 and at/above 300", () => {
    const response = new Response();

    response.setStatusCode(199);
    expect(response.isOk).toBe(false);

    response.setStatusCode(300);
    expect(response.isOk).toBe(false);

    response.setStatusCode(500);
    expect(response.isOk).toBe(false);
  });
});

describe("Response — reset()", () => {
  it("clears the body and resets the status to 200", () => {
    const response = new Response();

    response.body = { stale: true };
    response.setStatusCode(404);

    response.reset();

    expect(response.body).toBeNull();
    expect(response.statusCode).toBe(200);
  });
});

describe("ResponseStatus enum", () => {
  it("maps common names to their numeric codes", () => {
    expect(ResponseStatus.OK).toBe(200);
    expect(ResponseStatus.CREATED).toBe(201);
    expect(ResponseStatus.NO_CONTENT).toBe(204);
    expect(ResponseStatus.BAD_REQUEST).toBe(400);
    expect(ResponseStatus.UNAUTHORIZED).toBe(401);
    expect(ResponseStatus.FORBIDDEN).toBe(403);
    expect(ResponseStatus.NOT_FOUND).toBe(404);
    expect(ResponseStatus.TOO_MANY_REQUESTS).toBe(429);
    expect(ResponseStatus.INTERNAL_SERVER_ERROR).toBe(500);
  });
});
