import { describe, expect, it } from "vitest";
import { uuidV5 } from "./uuid-v5";

describe("uuidV5", () => {
  it("matches the RFC 4122 reference vector (DNS namespace, www.example.com)", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });

  it("is stable per name and differs between names", () => {
    expect(uuidV5("Shop API")).toBe(uuidV5("Shop API"));
    expect(uuidV5("Shop API")).not.toBe(uuidV5("Blog API"));
    expect(uuidV5("Shop API")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
