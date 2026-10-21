import { afterEach, describe, expect, it, vi } from "vitest";
import type { HydrationDocumentPayloadSource } from "../../hydration-payload";
import { getSessionIdentity, installSession, resetSession } from "../../session/use-user";
import { createLocaleChanger } from "./change-locale-code";
import { createRefresher, type RefreshRuntime } from "./refresh";

const fetched = vi.hoisted(() => vi.fn());
vi.mock("./fetch-page-data", () => ({ fetchPageData: fetched }));

function page(session: HydrationDocumentPayloadSource["session"]): HydrationDocumentPayloadSource {
  return {
    name: "home",
    locale: "en",
    translations: {},
    shared: {},
    appData: {},
    layoutData: {},
    pageData: {},
    session,
  };
}

afterEach(() => {
  resetSession();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe.each(["refresh", "locale"])("%s session publication", (type) => {
  function harness(buildTree: RefreshRuntime["buildTree"] = async () => null) {
    let current = true;
    let cookie = "";
    vi.stubGlobal("window", {
      location: { href: "https://example.test/", protocol: "https:" },
      history: { replaceState: vi.fn() },
    });
    vi.stubGlobal("document", {
      documentElement: {},
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        cookie = value.split(";")[0] ?? "";
      },
    });
    const initial = page(undefined);
    const runtime: RefreshRuntime = {
      claimTicket: () => ({ isCurrent: () => current, signal: new AbortController().signal }),
      readCurrent: () => ({ payload: initial, routeSource: initial, tree: null }),
      writeCurrent: vi.fn(),
      buildTree,
    };
    return {
      run: () =>
        type === "refresh" ? createRefresher(runtime)() : createLocaleChanger(runtime)("ar"),
      supersede: () => {
        current = false;
      },
    };
  }

  it.each([{ user: { id: "updated" } }, { user: null }, undefined])(
    "installs the fetched projection, including guests: %j",
    async (session) => {
      installSession({ user: { id: "old" } });
      const runtime = harness();
      fetched.mockResolvedValue({
        type: "payload",
        payload: page(session),
        url: "https://example.test/",
      });
      await runtime.run();
      expect(getSessionIdentity()).toBe(session?.user?.id ?? null);
    },
  );

  it("does not install an identity superseded while building", async () => {
    installSession({ user: { id: "current" } });
    let finish: (() => void) | undefined;
    const runtime = harness(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(null);
        }),
    );
    fetched.mockResolvedValue({
      type: "payload",
      payload: page({ user: { id: "stale" } }),
      url: "https://example.test/",
    });
    const pending = runtime.run();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    runtime.supersede();
    finish?.();
    await pending;
    expect(getSessionIdentity()).toBe("current");
  });

  it("keeps identity on a fetch failure", async () => {
    installSession({ user: { id: "current" } });
    fetched.mockResolvedValue({ type: "hard-navigate", reason: "network" });
    const runtime = harness();
    await runtime.run().catch(() => undefined);
    expect(getSessionIdentity()).toBe("current");
  });
});
