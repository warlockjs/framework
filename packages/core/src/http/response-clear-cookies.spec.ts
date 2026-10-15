import type { CookieSerializeOptions } from "@fastify/cookie";
import { beforeEach, describe, expect, it } from "vitest";
import { Request } from "./request";
import { Response } from "./response";

/**
 * `response.clearCookies()` is best-effort by construction: it only clears
 * cookies whose NAME appears on the current request, because that is all
 * HTTP hands the server. A cookie set on a different `Path`/`Domain` than
 * this call targets never even reaches this method's view — the browser
 * simply doesn't send it on a request to a non-matching path, and no error
 * is ever raised.
 *
 * `CookieJar` below is a minimal, RFC 6265–faithful browser model: it
 * decides whether a `Set-Cookie` is visible on a given request path with
 * the same path-match rule real browsers use (§5.1.4), and deletes a
 * cookie only when a NEW `Set-Cookie` matches its name, path AND domain
 * exactly (§5.3 step 11) — the same rule that makes a mismatched clear
 * silently no-op instead of erroring.
 */

type StoredCookie = { name: string; value: string; path: string; domain: string };

function isExpired(options: CookieSerializeOptions): boolean {
  if (options.maxAge !== undefined) return options.maxAge <= 0;
  if (options.expires) return options.expires.getTime() <= Date.now();
  return false;
}

/** RFC 6265 §5.1.4 path-match: does `requestPath` fall under `cookiePath`? */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

class CookieJar {
  private store = new Map<string, StoredCookie>();

  /** Feed it exactly what `response.cookie()` / `clearCookie()` hand `baseResponse`. */
  receive(name: string, value: string, options: CookieSerializeOptions) {
    const path = options.path ?? "/";
    const domain = options.domain ?? "";
    const key = `${domain}|${path}|${name}`;

    if (isExpired(options)) {
      this.store.delete(key);
    } else {
      this.store.set(key, { name, value, path, domain });
    }
  }

  /** What the browser would put in the `Cookie:` header for a request to `requestPath`. */
  cookiesVisibleAt(requestPath: string): Record<string, string> {
    const visible: Record<string, string> = {};

    for (const cookie of this.store.values()) {
      if (pathMatches(requestPath, cookie.path)) {
        visible[cookie.name] = cookie.value;
      }
    }

    return visible;
  }
}

function createResponse(jar: CookieJar, requestCookies: Record<string, string>) {
  const response = new Response();

  response.setResponse({
    setCookie: (name: string, value: string, options: CookieSerializeOptions) =>
      jar.receive(name, value, options),
    clearCookie: (name: string, options: CookieSerializeOptions) =>
      jar.receive(name, "", { ...options, maxAge: 0 }),
    raw: { once: () => {} },
  } as never);

  const request = new Request().setRequest({
    body: {},
    query: {},
    params: {},
    headers: {},
    cookies: requestCookies,
  } as never);

  response.request = request;

  return response;
}

describe("response.clearCookies() — best-effort, not exhaustive", () => {
  let jar: CookieJar;

  beforeEach(() => {
    jar = new CookieJar();
  });

  it("RED CONTROL: clears every cookie sent on THIS request, at the default path", () => {
    // A request to "/" carrying two default-path cookies.
    const response = createResponse(jar, { session: "abc", theme: "dark" });

    // Seed the jar as if these cookies had actually been set at "/" earlier.
    jar.receive("session", "abc", { path: "/" });
    jar.receive("theme", "dark", { path: "/" });
    expect(jar.cookiesVisibleAt("/")).toEqual({ session: "abc", theme: "dark" });

    response.clearCookies();

    // Innocent case: gone. Asserted affirmatively, not just "not thrown".
    expect(jar.cookiesVisibleAt("/")).toEqual({});
  });

  it("THE DEFECT: a cookie set on /a survives clearCookies() called on /b", () => {
    // Step 1: something sets a cookie explicitly scoped to /a.
    const writer = createResponse(jar, {});
    writer.cookie("token", "secret", { raw: true, path: "/a" });
    expect(jar.cookiesVisibleAt("/a")).toEqual({ token: "secret" });

    // Step 2: a later request to /b never carries "token" — the browser
    // never sends a cookie whose path doesn't path-match /b — so
    // request.cookies on /b is legitimately empty.
    expect(jar.cookiesVisibleAt("/b")).toEqual({});
    const clearer = createResponse(jar, jar.cookiesVisibleAt("/b"));

    clearer.clearCookies();

    // Observation 1: clearCookies() on /b did nothing wrong — it had
    // nothing to work with — and raised no error either.
    // Observation 2: the cookie is still alive at /a. This is the silent
    // survival the card exists to prove, not merely document.
    expect(jar.cookiesVisibleAt("/a")).toEqual({ token: "secret" });
  });

  it("an explicit matching path clears the cookie the default path would have missed", () => {
    const writer = createResponse(jar, {});
    writer.cookie("token", "secret", { raw: true, path: "/a" });

    // This time the caller KNOWS the cookie's scope and passes it through.
    const clearer = createResponse(jar, jar.cookiesVisibleAt("/a"));
    clearer.clearCookies({ path: "/a" });

    expect(jar.cookiesVisibleAt("/a")).toEqual({});
  });
});
