import { describe, expect, it } from "vitest";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  HttpError,
  NotAcceptableError,
  NotAllowedError,
  ResourceNotFoundError,
  ServerError,
  UnAuthorizedError,
} from "../../../src/http/errors/errors";

/**
 * The HTTP error class hierarchy. Each subclass pins a status code and a
 * `name`, and carries an optional `payload`. Source:
 * core/src/http/errors/errors.ts.
 */
describe("HttpError — base class", () => {
  it("stores status, message, and payload", () => {
    const error = new HttpError(418, "I'm a teapot", { brew: "tea" });

    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(418);
    expect(error.message).toBe("I'm a teapot");
    expect(error.payload).toEqual({ brew: "tea" });
    expect(error.name).toBe("HttpError");
  });

  it("is throwable and catchable as an Error", () => {
    expect(() => {
      throw new HttpError(500, "boom");
    }).toThrow("boom");
  });
});

describe("HttpError — subclass status + name contract", () => {
  const cases: Array<{
    Type: new (message: string, payload?: any) => HttpError;
    status: number;
    name: string;
  }> = [
    { Type: ResourceNotFoundError, status: 404, name: "ResourceNotFoundError" },
    { Type: UnAuthorizedError, status: 401, name: "UnAuthorizedError" },
    { Type: ForbiddenError, status: 403, name: "ForbiddenError" },
    { Type: BadRequestError, status: 400, name: "BadRequestError" },
    { Type: ServerError, status: 500, name: "ServerError" },
    { Type: ConflictError, status: 409, name: "ConflictError" },
    { Type: NotAcceptableError, status: 406, name: "NotAcceptableError" },
    { Type: NotAllowedError, status: 405, name: "NotAllowedError" },
  ];

  for (const { Type, status, name } of cases) {
    it(`${name} carries status ${status} and extends HttpError`, () => {
      const error = new Type("message", { detail: 1 });

      expect(error).toBeInstanceOf(HttpError);
      expect(error).toBeInstanceOf(Error);
      expect(error.status).toBe(status);
      expect(error.name).toBe(name);
      expect(error.message).toBe("message");
      expect(error.payload).toEqual({ detail: 1 });
    });
  }

  it("leaves payload undefined when not provided", () => {
    expect(new ResourceNotFoundError("missing").payload).toBeUndefined();
  });
});
