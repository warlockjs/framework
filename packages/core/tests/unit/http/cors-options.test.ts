import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { buildCorsOptions } from "../../../src/http/build-cors-options";

/**
 * The framework ships permissive CORS defaults and merges the application's
 * `http.cors` over them. The only property worth asserting is precedence: an
 * application that configures an allow-list must reach the wire with it.
 *
 * A test that asserted the shipped default would pass by construction and
 * catch nothing — which is how the defaults-win ordering survived three
 * releases with `http.cors` unreachable.
 */
describe("CORS options merge", () => {
  afterEach(() => {
    config.set("http.cors", undefined);
  });

  it("lets the application's origin win over the framework default", () => {
    config.set("http.cors", { origin: "https://app.example" });

    expect(buildCorsOptions().origin).toBe("https://app.example");
  });

  it("lets the application restrict methods", () => {
    config.set("http.cors", { methods: ["GET", "POST"] });

    expect(buildCorsOptions().methods).toEqual(["GET", "POST"]);
  });

  it("keeps the framework default for keys the application did not set", () => {
    config.set("http.cors", { origin: "https://app.example" });

    expect(buildCorsOptions().methods).toBe("*");
  });

  it("falls back to the permissive default when nothing is configured", () => {
    expect(buildCorsOptions()).toEqual({ origin: "*", methods: "*" });
  });
});
