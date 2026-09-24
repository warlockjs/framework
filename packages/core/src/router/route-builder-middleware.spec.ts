/**
 * Verb/nested middleware must be appended to the builder's, not replace it (finding B8).
 */
import { describe, expect, it } from "vitest";
import { RouteBuilder } from "./route-builder";

const auth = async () => undefined;
const cache = async () => undefined;

function build(builderOptions: any) {
  const calls: any[] = [];
  const router: any = { get: (_p: string, _h: any, options: any) => calls.push(options) };
  new RouteBuilder(router, "/admin/x", builderOptions).get((() => undefined) as any, {
    middleware: [cache],
  } as any);
  return calls[0];
}

describe("RouteBuilder middleware", () => {
  it("appends verb middleware after the builder's", () => {
    expect(build({ middleware: [auth] }).middleware).toEqual([auth, cache]);
  });

  it("dedupes by reference", () => {
    expect(build({ middleware: [cache, auth] }).middleware).toEqual([cache, auth]);
  });
});
