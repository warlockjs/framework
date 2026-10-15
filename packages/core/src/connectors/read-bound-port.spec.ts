import { describe, expect, it } from "vitest";

import { readBoundPort } from "./read-bound-port";

/**
 * The `http.port: 0` contract had no test. The connector reads the bound port
 * back out of what `listen()` resolved, and every comment in the area says why
 * — but nothing watched it do so, which is the shape canon `4a7f3259` warns
 * about: a guard nobody has seen work.
 *
 * The fallback argument is deliberately `0` in the port-0 cases, because that
 * is the real configured value in exactly the scenario this exists for. A
 * regression that returns the fallback would therefore produce `0`, which is
 * the observable defect, not a coincidence.
 */
describe("readBoundPort", () => {
  it("returns the port listen() resolved, not the configured 0", () => {
    expect(readBoundPort("http://127.0.0.1:49732", 0)).toBe(49732);
  });

  it("does the same for an IPv6 bind, where the host carries its own colons", () => {
    expect(readBoundPort("http://[::1]:49732", 0)).toBe(49732);
  });

  it("does the same over https", () => {
    expect(readBoundPort("https://127.0.0.1:8443", 0)).toBe(8443);
  });

  it("returns a number, not the string the URL parser hands back", () => {
    // `new URL(...).port` is a string; publishing it unconverted puts "49732"
    // into a numeric field and every comparison against it quietly fails.
    expect(readBoundPort("http://127.0.0.1:49732", 0)).toStrictEqual(49732);
  });

  it("still reports an ordinary configured port when that is what was bound", () => {
    // The innocent case: nothing about the normal path changes.
    expect(readBoundPort("http://127.0.0.1:2030", 2030)).toBe(2030);
  });

  it("falls back when the address carries no explicit port", () => {
    // A URL with the scheme's default port parses with an EMPTY port string.
    expect(readBoundPort("http://127.0.0.1", 2030)).toBe(2030);
  });

  it("falls back rather than throwing on an address that is not a URL at all", () => {
    // A unix socket path is the realistic version of this.
    expect(readBoundPort("/tmp/warlock.sock", 2030)).toBe(2030);
  });

  it("falls back rather than throwing on an empty address", () => {
    expect(readBoundPort("", 2030)).toBe(2030);
  });
});
