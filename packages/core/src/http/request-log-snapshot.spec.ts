import config from "@mongez/config";
import type { MultipartFile } from "@fastify/multipart";
import { afterEach, describe, expect, it } from "vitest";
import { buildRequestLogSnapshot, redactUrlCredentials } from "./request-log-snapshot";
import { UploadedFile } from "./uploaded-file";

afterEach(() => {
  config.set("http.logging", undefined);
});

describe("redactUrlCredentials", () => {
  it("masks credential-bearing query values and keeps the rest", () => {
    expect(redactUrlCredentials("/hooks?secret=s3&page=2")).toBe("/hooks?secret=[REDACTED]&page=2");
    expect(redactUrlCredentials("/a?api_key=k&accessToken=t&q=x")).toBe(
      "/a?api_key=[REDACTED]&accessToken=[REDACTED]&q=x",
    );
  });

  it("masks signed-URL and OAuth parameters the key denylist does not name", () => {
    expect(redactUrlCredentials("/f?X-Amz-Signature=abc&X-Amz-Credential=c&v=1")).toBe(
      "/f?X-Amz-Signature=[REDACTED]&X-Amz-Credential=[REDACTED]&v=1",
    );
    expect(redactUrlCredentials("/oauth/callback?code=abc&state=xyz")).toBe(
      "/oauth/callback?code=[REDACTED]&state=xyz",
    );
  });

  it("matches percent-encoded parameter names", () => {
    expect(redactUrlCredentials("/a?%73ecret=s3")).toBe("/a?%73ecret=[REDACTED]");
  });

  it("masks app-configured parameters", () => {
    expect(redactUrlCredentials("/a?workspace_key=w&b=1", ["workspaceKey"])).toBe(
      "/a?workspace_key=[REDACTED]&b=1",
    );
  });

  it("leaves URLs without a query unchanged and drops a fragment", () => {
    expect(redactUrlCredentials("/plain/path")).toBe("/plain/path");
    expect(redactUrlCredentials("https://x.test/a?token=t#frag")).toBe(
      "https://x.test/a?token=[REDACTED]",
    );
  });
});

describe("buildRequestLogSnapshot", () => {
  const source = {
    id: "req-1",
    method: "POST",
    url: "/accounts?secret=url-sentinel&tab=keys",
    ip: "127.0.0.1",
    userAgent: "vitest",
    query: { secret: "url-sentinel", tab: "keys" },
    body: { providerId: "body-sentinel", nested: { deep: "nested-sentinel" } },
  };

  it("carries plain request data with the URL credentials masked", () => {
    const snapshot = buildRequestLogSnapshot({
      ...source,
      route: { path: "/accounts", name: "accounts.store" },
    });

    expect(snapshot).toEqual({
      id: "req-1",
      method: "POST",
      url: "/accounts?secret=[REDACTED]&tab=keys",
      route: "/accounts",
      name: "accounts.store",
      ip: "127.0.0.1",
      userAgent: "vitest",
      query: { secret: "url-sentinel", tab: "keys" },
      body: { providerId: "body-sentinel", nested: { deep: "nested-sentinel" } },
    });
  });

  it("omits body and query, including the URL's query string, per route", () => {
    const snapshot = buildRequestLogSnapshot({
      ...source,
      route: { path: "/accounts", logging: { body: false, query: false } },
    });

    const serialized = JSON.stringify(snapshot);

    expect(snapshot.url).toBe("/accounts");
    expect(snapshot.body).toBeUndefined();
    expect(snapshot.query).toBeUndefined();
    expect(serialized).not.toContain("sentinel");
  });

  it("applies http.logging defaults, with the route overriding key by key", () => {
    config.set("http.logging", { body: false });

    expect(buildRequestLogSnapshot({ ...source, route: { path: "/a" } }).body).toBeUndefined();
    expect(
      buildRequestLogSnapshot({ ...source, route: { path: "/a", logging: { body: true } } }).body,
    ).toBeDefined();
  });

  it("masks the configured extra query parameters", () => {
    config.set("http.logging", { redactQueryParams: ["tab"] });

    expect(buildRequestLogSnapshot(source).url).toBe("/accounts?secret=[REDACTED]&tab=[REDACTED]");
  });

  it("summarises uploaded files instead of walking them", () => {
    const file = new UploadedFile({
      filename: "avatar.png",
      mimetype: "image/png",
    } as unknown as MultipartFile);

    const snapshot = buildRequestLogSnapshot({
      ...source,
      body: { avatar: file, gallery: [file] },
    });

    expect(snapshot.body).toEqual({
      avatar: { file: "avatar.png", mimeType: "image/png" },
      gallery: [{ file: "avatar.png", mimeType: "image/png" }],
    });
  });
});
