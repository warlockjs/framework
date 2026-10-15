import { beforeEach, describe, expect, it } from "vitest";
import { ResourceFieldBuilder } from "../../../src/resource/resource-field-builder";
import { setBaseUrl } from "../../../src/utils/urls";

beforeEach(() => {
  setBaseUrl("https://store.test");
});

describe("ResourceFieldBuilder.fromCastType", () => {
  it("parses a bare cast type", () => {
    expect(ResourceFieldBuilder.fromCastType("string").transform(42)).toBe("42");
  });

  it("parses the nullable ? suffix", () => {
    const builder = ResourceFieldBuilder.fromCastType("number?");

    expect(builder.transform(null)).toBeNull();
    expect(builder.transform(undefined)).toBeNull();
    expect(builder.transform("7")).toBe(7);
  });

  it("parses the array [] suffix", () => {
    const builder = ResourceFieldBuilder.fromCastType("number[]");

    expect(builder.transform(["1", "2", "3"])).toEqual([1, 2, 3]);
  });

  it("parses combined []? suffix (array before nullable)", () => {
    const builder = ResourceFieldBuilder.fromCastType("string[]?");

    expect(builder.transform(null)).toBeNull();
    expect(builder.transform(["a", 2])).toEqual(["a", "2"]);
  });
});

describe("primitive casts", () => {
  it("casts string", () => {
    expect(new ResourceFieldBuilder("string").transform(123)).toBe("123");
  });

  it("casts number, dropping NaN to undefined", () => {
    expect(new ResourceFieldBuilder("number").transform("42")).toBe(42);
    expect(new ResourceFieldBuilder("number").transform("nope")).toBeUndefined();
  });

  it("casts boolean", () => {
    expect(new ResourceFieldBuilder("boolean").transform(1)).toBe(true);
    expect(new ResourceFieldBuilder("boolean").transform(0)).toBe(false);
  });

  it("casts float and int", () => {
    expect(new ResourceFieldBuilder("float").transform("3.14abc")).toBe(3.14);
    expect(new ResourceFieldBuilder("int").transform("10.99")).toBe(10);
  });

  it("casts object, rejecting arrays and empty objects", () => {
    expect(new ResourceFieldBuilder("object").transform({ a: 1 })).toEqual({ a: 1 });
    expect(new ResourceFieldBuilder("object").transform([1, 2])).toBeUndefined();
    expect(new ResourceFieldBuilder("object").transform({})).toBeUndefined();
  });

  it("casts array, rejecting non-arrays", () => {
    expect(new ResourceFieldBuilder("array").transform([1, 2])).toEqual([1, 2]);
    expect(new ResourceFieldBuilder("array").transform("x")).toBeUndefined();
  });
});

describe("url casts", () => {
  it("builds an absolute url", () => {
    expect(new ResourceFieldBuilder("url").transform("page")).toBe(
      "https://store.test/page",
    );
  });

  it("builds an uploads url", () => {
    expect(new ResourceFieldBuilder("uploadsUrl").transform("a.png")).toBe(
      "https://store.test/uploads/a.png",
    );
  });
});

describe("nullable and default handling", () => {
  it("returns the default value for null when not nullable", () => {
    const builder = new ResourceFieldBuilder("string").default("anonymous");

    expect(builder.transform(null)).toBe("anonymous");
  });

  it("returns null for null when nullable, ignoring the default", () => {
    const builder = new ResourceFieldBuilder("string").default("anonymous").nullable();

    expect(builder.transform(null)).toBeNull();
  });

  it("returns an empty array for a non-array value on an array field", () => {
    expect(new ResourceFieldBuilder("string").array().transform("notArray")).toEqual([]);
  });

  it("returns null for a non-array value on a nullable array field", () => {
    expect(
      new ResourceFieldBuilder("string").array().nullable().transform(null),
    ).toBeNull();
  });
});

describe("when condition", () => {
  it("skips the value when the condition is false", () => {
    const builder = new ResourceFieldBuilder("string").when(() => false);

    expect(builder.transform("hidden")).toBeUndefined();
  });

  it("keeps the value when the condition is true", () => {
    const builder = new ResourceFieldBuilder("string").when(() => true);

    expect(builder.transform("shown")).toBe("shown");
  });
});

describe("localized cast", () => {
  it("returns the first entry value when no locale is set", () => {
    const value = [
      { localeCode: "en", value: "Hello" },
      { localeCode: "ar", value: "مرحبا" },
    ];

    expect(new ResourceFieldBuilder("localized").transform(value)).toBe("Hello");
  });

  it("returns the matching locale value when a locale is given", () => {
    const value = [
      { localeCode: "en", value: "Hello" },
      { localeCode: "ar", value: "مرحبا" },
    ];

    expect(new ResourceFieldBuilder("localized").transform(value, "ar")).toBe("مرحبا");
  });

  it("returns a string value as-is", () => {
    expect(new ResourceFieldBuilder("localized").transform("plain")).toBe("plain");
  });
});

describe("date cast", () => {
  const when = new Date("2024-03-15T10:30:00.000Z");

  it("returns a formatted string when dateOptions is 'format'", () => {
    const builder = new ResourceFieldBuilder("date")
      .dateOptions("format")
      .format("YYYY-MM-DD");

    expect(builder.transform(when)).toBe("2024-03-15");
  });

  it("returns an ISO string when dateOptions is 'iso'", () => {
    const builder = new ResourceFieldBuilder("date").dateOptions("iso");

    expect(builder.transform(when)).toBe("2024-03-15T10:30:00.000Z");
  });

  it("returns a timestamp when dateOptions is 'timestamp'", () => {
    const builder = new ResourceFieldBuilder("date").dateOptions("timestamp");

    expect(builder.transform(when)).toBe(when.valueOf());
  });

  it("returns an object with the requested parts when dateOptions is an object", () => {
    const builder = new ResourceFieldBuilder("date")
      .dateOptions({ iso: true, timestamp: true })
      .format("YYYY-MM-DD");

    const output = builder.transform(when) as Record<string, unknown>;

    expect(output.iso).toBe("2024-03-15T10:30:00.000Z");
    expect(output.timestamp).toBe(when.valueOf());
    expect(output.format).toBeUndefined();
  });
});
