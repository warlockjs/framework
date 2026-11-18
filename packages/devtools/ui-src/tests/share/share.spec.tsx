import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DevtoolsShareOpenAnswer } from "@contracts";
import { App } from "@/app/App";
import { setPanelModuleLoader } from "@/panel-host/modules";
import type { LegacyPanelContext } from "@/panel-host/types";
import { isShareHash, shareRouteOf } from "@/lib/route";
import { mockApi } from "../helpers/api";

afterEach(() => setPanelModuleLoader(null));

const info: DevtoolsShareOpenAnswer = {
  panel: "grimoire",
  title: "Grimoire",
  label: "Quarterly review",
  expiresAt: new Date("2030-05-04T12:00:00Z").getTime(),
  assets: ["product-map.css"],
  files: true,
};

function sharedModule() {
  const seen: LegacyPanelContext[] = [];
  const loader = vi.fn(async () => ({
    default(context: LegacyPanelContext) {
      seen.push(context);
      context.root.append(context.el("p", { text: `route=${context.route}` }));
    },
  }));

  setPanelModuleLoader(loader);

  return { seen, loader };
}

describe("the share screen", () => {
  it("exchanges the token once, removes it from the address and shows only the shared view", async () => {
    window.location.hash = "#/share/tok-secret";

    const api = mockApi({ "POST api/share/open": { body: info } });
    const { seen, loader } = sharedModule();

    render(<App />);

    expect(await screen.findByText("route=")).toBeInTheDocument();
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST api/share/open"]);
    expect(api.calls[0]?.body).toEqual({ token: "tok-secret" });
    expect(api.calls[0]?.headers.has("X-Devtools-Csrf")).toBe(false);
    // The shell never reads a session for a share link.
    expect(api.calls.some((call) => call.path === "api/auth/session")).toBe(false);
    expect(window.location.hash).toBe("#/share");
    expect(window.location.href).not.toContain("tok-secret");
    expect(loader).toHaveBeenCalledWith("grimoire", true);

    expect(screen.getByRole("heading", { name: "Grimoire" })).toBeInTheDocument();
    expect(screen.getByText("Quarterly review")).toBeInTheDocument();
    expect(screen.getByTestId("share-expiry")).toHaveTextContent(/Read-only link · expires/);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("Requests")).not.toBeInTheDocument();

    const context = seen[0]!;

    expect(context.shared).toBe(true);
    expect(context.share).toBeNull();
    expect(context.asset("product-map.css")).toBe(
      new URL("api/share/assets/product-map.css", document.baseURI).href,
    );
    expect(context.file("a b/c.png")).toBe(new URL("api/share/files/a%20b/c.png", document.baseURI).href);
    expect(context.href("product/feature/x")).toBe("#share/product/feature/x");
  });

  it("calls the shared panel routes, never the signed-in ones, and sends no CSRF header", async () => {
    window.location.hash = "#/share/tok";

    const api = mockApi({
      "POST api/share/open": { body: info },
      "api/share/panel/product": { body: { features: [] } },
      "api/share/panel": { body: { root: true } },
      "api/share/panel/product/features/a?x=1": { body: { ok: 1 } },
    });
    const { seen } = sharedModule();

    render(<App />);
    await screen.findByText("route=");

    await expect(seen[0]!.api("/product")).resolves.toEqual({ features: [] });
    await expect(seen[0]!.api("product/features/a?x=1")).resolves.toEqual({ ok: 1 });
    await expect(seen[0]!.api()).resolves.toEqual({ root: true });

    const calls = api.calls.map((call) => call.url);

    expect(calls).toContain("api/share/panel/product");
    expect(calls).toContain("api/share/panel/product/features/a?x=1");
    expect(calls).toContain("api/share/panel");
    expect(calls.some((url) => url.startsWith("api/grimoire"))).toBe(false);
  });

  it("renders the view again when it navigates, and follows #product/... links", async () => {
    window.location.hash = "#/share/tok";

    mockApi({ "POST api/share/open": { body: info } });

    const { seen } = sharedModule();

    render(<App />);
    await screen.findByText("route=");

    act(() => seen[0]!.navigate("product/feature/a"));

    expect(await screen.findByText("route=product/feature/a")).toBeInTheDocument();
    expect(window.location.hash).toBe("#share/product/feature/a");

    act(() => {
      window.location.hash = "#product/flow/a/b";
    });

    expect(await screen.findByText("route=product/flow/a/b")).toBeInTheDocument();
  });

  it("reads the grant again from the cookie after a reload, with no token", async () => {
    window.location.hash = "#/share";

    const api = mockApi({ "api/share/info": { body: info } });

    sharedModule();
    render(<App />);

    expect(await screen.findByText("route=")).toBeInTheDocument();
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET api/share/info"]);
  });

  it.each([
    ["an unknown token", "#/share/bad"],
    ["a reload after the grant ended", "#/share"],
  ])("says the link expired or was revoked for %s", async (_name, hash) => {
    window.location.hash = hash;
    mockApi({
      "POST api/share/open": { status: 404 },
      "api/share/info": { status: 404 },
    });
    sharedModule();

    render(<App />);

    expect(await screen.findByText(/This link has expired or was revoked/)).toBeInTheDocument();
    expect(screen.getByText(/Ask the person who shared it for a new one\./)).toBeInTheDocument();
  });

  it("offers a retry when the server cannot be reached", async () => {
    window.location.hash = "#/share";

    let attempts = 0;
    const api = mockApi({
      "api/share/info": () => {
        attempts += 1;

        return attempts === 1 ? { status: 503, body: { error: "The server is busy." } } : { body: info };
      },
    });

    sharedModule();
    render(<App />);

    expect(await screen.findByText("The server is busy.")).toBeInTheDocument();

    screen.getByRole("button", { name: "Try again" }).click();

    expect(await screen.findByText("route=")).toBeInTheDocument();
    await waitFor(() => expect(api.calls).toHaveLength(2));
  });
});

describe("share hashes", () => {
  it.each([
    ["#/share/abc", true],
    ["#/share", true],
    ["#share/product/x", true],
    ["#share", true],
    ["#/shared", false],
    ["#sharepoint", false],
    ["#requests", false],
    ["#/admin/shares", false],
    ["", false],
  ])("isShareHash(%j) is %s", (hash, expected) => {
    expect(isShareHash(hash)).toBe(expected);
  });

  it.each([
    ["#/share", ""],
    ["#/share/tok", ""],
    ["#share", ""],
    ["#share/product/feature/a", "product/feature/a"],
    ["#product/flow/a/b", "product/flow/a/b"],
    ["", ""],
  ])("shareRouteOf(%j) is %j", (hash, expected) => {
    expect(shareRouteOf(hash)).toBe(expected);
  });
});
