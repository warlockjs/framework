import { beforeEach, describe, expect, it } from "vitest";
import { Resource } from "../../../src/resource/resource";
import { ResourceFieldBuilder } from "../../../src/resource/resource-field-builder";
import { setBaseUrl } from "../../../src/utils/urls";

/**
 * Extends resource-field-builder.test.ts into the date "locale" string-form,
 * the localized fallback, and the Resource factory methods that mint builders.
 * Source: core/src/resource/resource-field-builder.ts +
 * core/src/resource/resource.ts.
 *
 * NOTE: the `storageUrl` cast is intentionally NOT tested here — it calls the
 * global storage singleton's driver, which is null until storage config is
 * bootstrapped (config-gated, out of scope for a pure unit test).
 */
beforeEach(() => {
  setBaseUrl("https://store.test");
});

describe("date cast — locale string-form", () => {
  const when = new Date("2024-03-15T10:30:00.000Z");

  it("formats with the default format when dateOptions('locale') has no locale", () => {
    const builder = new ResourceFieldBuilder("date").dateOptions("locale").format("YYYY-MM-DD");

    expect(builder.transform(when)).toBe("2024-03-15");
  });

  it("formats through the given locale when one is supplied", () => {
    const builder = new ResourceFieldBuilder("date").dateOptions("locale").format("YYYY-MM-DD");

    // dayjs falls back to the default (en) format string for an unloaded locale,
    // so the formatted output is stable regardless of locale data.
    expect(builder.transform(when, "en")).toBe("2024-03-15");
  });

  // The default dateOptions has `humanTime: true`, and the object-form date
  // transform calls dayjs(...).fromNow(). core extends dayjs with the
  // `relativeTime` plugin (resource-field-builder.ts), so a default date cast
  // now produces a relative-time string instead of crashing.
  // Source: core/src/resource/resource-field-builder.ts:292 (+ :252 for string form).
  it("produces a relative-time humanTime on a default object-form date cast", () => {
    const builder = new ResourceFieldBuilder("date");

    const output = builder.transform(when) as Record<string, unknown>;

    expect(typeof output.humanTime).toBe("string");
    // `when` is in the past, so fromNow() yields an "... ago" phrase.
    expect(output.humanTime).toMatch(/ago$/);
  });

  it("works for an object-form date that excludes humanTime", () => {
    const builder = new ResourceFieldBuilder("date")
      .dateOptions({ iso: true, timestamp: true, humanTime: false })
      .format("YYYY-MM-DD");

    const output = builder.transform(when) as Record<string, unknown>;

    expect(output.iso).toBe("2024-03-15T10:30:00.000Z");
    expect(output.timestamp).toBe(when.valueOf());
  });
});

describe("localized cast — fallback when first entry lacks a value", () => {
  it("returns the whole array when the first entry has no .value and no locale", () => {
    const value = [{ localeCode: "en" }];

    expect(new ResourceFieldBuilder("localized").transform(value)).toEqual(value);
  });

  it("returns undefined when a locale is given but nothing matches", () => {
    const value = [{ localeCode: "en", value: "Hello" }];

    expect(new ResourceFieldBuilder("localized").transform(value, "fr")).toBeUndefined();
  });
});

describe("Resource — field builder factory methods", () => {
  const resource = new Resource({});

  it("each factory returns a configured ResourceFieldBuilder of the right type", () => {
    expect(resource.string().transform(7)).toBe("7");
    expect(resource.int().transform("10.9")).toBe(10);
    expect(resource.float().transform("3.14x")).toBe(3.14);
    expect(resource.number().transform("42")).toBe(42);
    expect(resource.boolean().transform(1)).toBe(true);
    expect(resource.url().transform("page")).toBe("https://store.test/page");
    expect(resource.uploadsUrl().transform("a.png")).toBe("https://store.test/uploads/a.png");
    expect(resource.date().constructor.name).toBe("ResourceFieldBuilder");
    expect(resource.localized().transform("plain")).toBe("plain");
  });

  it("threads an explicit inputKey into the builder", () => {
    const builder = resource.string("source");

    expect(builder.getInputKey()).toBe("source");
  });

  it("transform() casts a one-off value via a fresh builder", () => {
    expect(resource.transform("123", "int")).toBe(123);
    expect(resource.transform("page", "url")).toBe("https://store.test/page");
  });
});
