import { describe, expect, it } from "vitest";
import { localStorageWarning, memoryCacheWarning } from "./single-server-warnings";

describe("memoryCacheWarning", () => {
  it("warns in production with the memory driver", () => {
    const message = memoryCacheWarning("memory", undefined, "production");

    expect(message).toContain("'memory' keeps data in this process only");
    expect(message).toContain("cache.silenceSingleServerWarning");
  });

  it("warns for lru matched by driver class", () => {
    expect(memoryCacheWarning("main", "LRUMemoryCacheDriver", "production")).toBeDefined();
  });

  it("is silent in development", () => {
    expect(memoryCacheWarning("memory", undefined, "development")).toBeUndefined();
  });

  it("is silent for redis", () => {
    expect(memoryCacheWarning("redis", "RedisCacheDriver", "production")).toBeUndefined();
  });

  it("is silent when silenced", () => {
    expect(memoryCacheWarning("memory", undefined, "production", true)).toBeUndefined();
  });
});

describe("localStorageWarning", () => {
  it("warns in production with the local driver", () => {
    const message = localStorageWarning("local", "production");

    expect(message).toContain("S3");
    expect(message).toContain("storage.silenceSingleServerWarning");
  });

  it("is silent for other drivers, development, or when silenced", () => {
    expect(localStorageWarning("s3", "production")).toBeUndefined();
    expect(localStorageWarning("local", "development")).toBeUndefined();
    expect(localStorageWarning("local", "production", true)).toBeUndefined();
  });
});
