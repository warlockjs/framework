import { isRawInput } from "@warlock.js/cascade";
import { describe, expect, it } from "vitest";
import { Request } from "./request";

function requestWith(body: Record<string, unknown>, query: Record<string, unknown> = {}) {
  const request = new Request();

  request.setRequest({
    method: "POST",
    url: "/users",
    headers: {},
    body,
    query,
    params: {},
  } as never);

  return request;
}

describe("raw input getters", () => {
  it("mark the objects that carry the whole body so a model can warn about them", () => {
    const request = requestWith({ name: "Ann", role: "admin" }, { page: "1" });

    expect(isRawInput(request.all())).toBe(true);
    expect(isRawInput(request.body)).toBe(true);
    expect(isRawInput(request.allExceptParams())).toBe(true);
    expect(isRawInput(request.heavy())).toBe(true);
    expect(isRawInput(request.only(["name"]))).toBe(true);
    expect(isRawInput(request.except(["role"]))).toBe(true);
  });

  it("do not mark the validated input, and still return the same values", () => {
    const request = requestWith({ name: "Ann" });

    expect(request.all()).toMatchObject({ name: "Ann" });
    expect(isRawInput(request.validated())).toBe(false);
  });

  it("return an absent body untouched", () => {
    const request = new Request();

    request.setRequest({ method: "GET", url: "/", headers: {}, query: {}, params: {} } as never);

    expect(() => request.body).not.toThrow();
  });
});
