import { describe, expect, it } from "vitest";
import { parseName } from "../utils/name-parser";
import { useCaseSpecStub, useCaseStub } from "../templates/stubs";

describe("use-case stubs", () => {
  const name = parseName("place-order");
  const source = useCaseStub(name);

  it("exports an async <verbNoun>UseCase(input, actor) returning a result union", () => {
    expect(source).toContain("export async function placeOrderUseCase(");
    expect(source).toContain("input: PlaceOrderSchema");
    expect(source).toContain("actor: PlaceOrderActor");
    expect(source).toContain('{ code: "OK" }');
    expect(source).toContain('{ code: "NOT_FOUND" }');
  });

  it("takes no request or response and avoids .required()/satisfies", () => {
    expect(source).not.toMatch(/request|response/i);
    expect(source).not.toContain(".required()");
    expect(source).not.toContain("satisfies");
  });

  it("emits a sibling vitest spec importing the use-case", () => {
    const spec = useCaseSpecStub(name);
    expect(spec).toContain('from "vitest"');
    expect(spec).toContain('from "./place-order.use-case"');
    expect(spec).not.toContain("satisfies");
  });
});
