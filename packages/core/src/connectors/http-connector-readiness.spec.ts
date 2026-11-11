/**
 * The public readiness probe lists its checks outside production only, unless
 * `http.health.details` says otherwise.
 */
import config from "@mongez/config";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Application } from "../application";
import { health } from "../http/health";
import { getHttpServer } from "../http/server";
import { HttpConnector } from "./http-connector";

vi.mock("@warlock.js/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@warlock.js/logger")>()),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    flush: vi.fn(),
  },
}));

vi.setConfig({ testTimeout: 120_000 });

const originalEnv = process.env.NODE_ENV;

beforeAll(() => {
  Application.markBooted({ environment: "test", runtimeStrategy: "development" });
  health.addCheck("db", () => true);
});

afterEach(async () => {
  await getHttpServer()?.close();
  config.set("http", undefined);
  process.env.NODE_ENV = originalEnv;
});

async function readiness(httpConfig: Record<string, unknown> = {}) {
  config.set("http", { port: 0, host: "127.0.0.1", ...httpConfig });

  await new HttpConnector().boot();

  const response = await getHttpServer().inject({ method: "GET", url: "/ready" });

  return { status: response.statusCode, body: response.json() };
}

describe("readiness details", () => {
  it("lists the checks outside production", async () => {
    expect(await readiness()).toEqual({
      status: 200,
      body: { status: "ok", checks: { db: true } },
    });
  });

  it("answers the status only in production", async () => {
    process.env.NODE_ENV = "production";

    expect(await readiness()).toEqual({ status: 200, body: { status: "ok" } });
  });

  it("follows http.health.details", async () => {
    process.env.NODE_ENV = "production";

    expect((await readiness({ health: { details: true } })).body.checks).toEqual({ db: true });

    process.env.NODE_ENV = originalEnv;

    expect((await readiness({ health: { details: false } })).body).toEqual({ status: "ok" });
  });
});
