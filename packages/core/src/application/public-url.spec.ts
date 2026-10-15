import config from "@mongez/config";
import { afterEach, describe, expect, it } from "vitest";
import { getPublicUrl } from "./public-url";

describe("getPublicUrl", () => {
  afterEach(() => {
    config.set("app", {});
    delete process.env.PUBLIC_APP_URL;
  });

  it("returns undefined when neither the config key nor the env var is set", () => {
    config.set("app", {});

    expect(getPublicUrl()).toBeUndefined();
  });

  it("falls back to PUBLIC_APP_URL when app.publicUrl is not set", () => {
    config.set("app", {});
    process.env.PUBLIC_APP_URL = "https://example.test";

    expect(getPublicUrl()).toBe("https://example.test");
  });

  it("prefers app.publicUrl over PUBLIC_APP_URL", () => {
    config.set("app", { publicUrl: "https://from-config.test" });
    process.env.PUBLIC_APP_URL = "https://from-env.test";

    expect(getPublicUrl()).toBe("https://from-config.test");
  });
});
