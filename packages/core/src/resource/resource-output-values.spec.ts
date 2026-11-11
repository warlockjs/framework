import dayjs from "dayjs";
import { afterEach, describe, expect, it } from "vitest";
import { assetsUrl, publicUrl, setBaseUrl, uploadsUrl, url } from "../utils/urls";
import { ResourceFieldBuilder } from "./resource-field-builder";

const value = "2026-03-04T05:06:07.000Z";

describe("date fields", () => {
  it("keeps the default object shape and key order", () => {
    const output = new ResourceFieldBuilder("date").transform(value);

    expect(Object.keys(output)).toEqual(["iso", "format", "timestamp", "humanTime"]);
    expect(output).toMatchObject({
      iso: value,
      format: dayjs(value).format("DD-MM-YYYY hh:mm:ss A"),
      timestamp: Date.parse(value),
    });
    expect(typeof output.humanTime).toBe("string");
  });

  it("reads the iso key of a value that already went through a resource", () => {
    const output = new ResourceFieldBuilder("date").transform({ iso: value });

    expect(output.iso).toBe(value);
    expect(output.timestamp).toBe(Date.parse(value));
  });

  it("returns the single representation that was asked for", () => {
    const build = (mode: "iso" | "timestamp" | "format") =>
      new ResourceFieldBuilder("date").dateOptions(mode).transform(new Date(value));

    expect(build("iso")).toBe(value);
    expect(build("timestamp")).toBe(Date.parse(value));
    expect(build("format")).toBe(dayjs(value).format("DD-MM-YYYY hh:mm:ss A"));
  });

  it("answers bad data with undefined, or null when nullable", () => {
    expect(new ResourceFieldBuilder("date").transform("not a date")).toBeUndefined();
    expect(new ResourceFieldBuilder("date").nullable().transform("")).toBeNull();
  });
});

describe("url helpers", () => {
  afterEach(() => setBaseUrl(""));

  it("joins the base url and path with exactly one slash", () => {
    setBaseUrl("https://example.com//");

    expect(url("/a/b")).toBe("https://example.com/a/b");
    expect(url("a")).toBe("https://example.com/a");
    expect(url()).toBe("https://example.com/");
    expect(uploadsUrl("//images/x.png")).toBe("https://example.com/uploads/images/x.png");
    expect(publicUrl("css/app.css")).toBe("https://example.com/public/css/app.css");
    expect(assetsUrl("/logo.svg")).toBe("https://example.com/public/assets/logo.svg");
  });

  it("works with no base url", () => {
    setBaseUrl("");

    expect(url("/a")).toBe("/a");
    expect(uploadsUrl("x.png")).toBe("/uploads/x.png");
  });

  it("feeds the url builders of resource fields", () => {
    setBaseUrl("https://cdn.example.com/");

    expect(new ResourceFieldBuilder("uploadsUrl").transform("/a.png")).toBe(
      "https://cdn.example.com/uploads/a.png",
    );
    expect(new ResourceFieldBuilder("url").transform("path")).toBe("https://cdn.example.com/path");
  });
});
