import config from "@mongez/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Application } from "../../../src/application/application";
import { Response } from "../../../src/http/response";

/**
 * Cover for the secure-by-default cookie flags added in 4.10.0, raised by
 * kafr-yasef in `plans/2026-08-09-auth-gaps-for-cookie-sessions-findings-to-verify.md`.
 *
 * `response.cookie` previously passed only what the caller supplied plus the
 * `http.cookies.options` config (which ships empty), so a cookie was readable
 * by any injected script, sent in cleartext, and attached to cross-site
 * requests unless the developer knew to set three flags by hand. Nothing failed
 * when they were missing — the app worked and was simply insecure.
 *
 * Precedence under test, lowest to highest:
 *   framework defaults → http.cookies.options → per-call options
 */

/**
 * Capture what actually reaches Fastify's `setCookie`.
 *
 * `setResponse` also attaches a `finish` listener to the raw response, so the
 * stub needs a `raw.once` — it never fires here.
 */
function createResponse() {
  const setCookie = vi.fn();
  const response = new Response();

  response.setResponse({ setCookie, raw: { once: vi.fn() } } as never);

  return { response, setCookie };
}

const optionsFor = (setCookie: ReturnType<typeof vi.fn>) => setCookie.mock.calls[0][2];

describe("response.cookie security defaults", () => {
  beforeEach(() => {
    config.set("http.cookies.options", {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    config.set("http.cookies.options", {});
  });

  it("applies httpOnly, sameSite and secure without being asked", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(false);

    const { response, setCookie } = createResponse();
    response.cookie("session", "abc", { raw: true });

    expect(optionsFor(setCookie)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
    });
  });

  it("relaxes only `secure` in development, so local http logins still work", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(true);

    const { response, setCookie } = createResponse();
    response.cookie("session", "abc", { raw: true });

    expect(optionsFor(setCookie)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
    });
  });

  it("lets a per-call option override a default", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(false);

    const { response, setCookie } = createResponse();
    response.cookie("theme", "dark", { raw: true, httpOnly: false });

    expect(optionsFor(setCookie).httpOnly).toBe(false);
    // Siblings survive the single override.
    expect(optionsFor(setCookie).sameSite).toBe("lax");
  });

  it("lets http.cookies.options override a default", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(false);
    config.set("http.cookies.options", { sameSite: "strict" });

    const { response, setCookie } = createResponse();
    response.cookie("session", "abc", { raw: true });

    expect(optionsFor(setCookie).sameSite).toBe("strict");
    expect(optionsFor(setCookie).httpOnly).toBe(true);
  });

  it("ranks a per-call option above the config", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(false);
    config.set("http.cookies.options", { sameSite: "strict" });

    const { response, setCookie } = createResponse();
    response.cookie("session", "abc", { raw: true, sameSite: "none" });

    expect(optionsFor(setCookie).sameSite).toBe("none");
  });

  it("still passes through unrelated options", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(false);

    const { response, setCookie } = createResponse();
    response.cookie("session", "abc", { raw: true, maxAge: 3600, path: "/admin" });

    expect(optionsFor(setCookie)).toMatchObject({ maxAge: 3600, path: "/admin", httpOnly: true });
  });

  it("does not change how the value itself is serialized", () => {
    vi.spyOn(Application, "isDevelopment", "get").mockReturnValue(false);

    const { response, setCookie } = createResponse();
    response.cookie("prefs", { theme: "dark" });

    expect(setCookie.mock.calls[0][1]).toBe(JSON.stringify({ theme: "dark" }));
  });
});
