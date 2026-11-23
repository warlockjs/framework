import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCsrfToken } from "@/api/client";
import { PanelHost } from "@/panel-host/PanelHost";
import { setPanelModuleLoader } from "@/panel-host/modules";
import type { LegacyPanelContext, LegacyPanelModule } from "@/panel-host/types";
import { mockApi } from "../helpers/api";

afterEach(() => setPanelModuleLoader(null));

describe("PanelHost", () => {
  it("renders the 5.55 fixture view module with the 5.55 context", async () => {
    // The fixture the server specs use: it calls api("search?q=a") and draws bars with the rows' count.
    // @ts-expect-error The fixture is a plain JavaScript view module without a declaration file.
    const imported = await import("../../../tests/fixtures/test-panel/view.js");
    const fixture = imported as unknown as LegacyPanelModule;
    const api = mockApi({ "api/test/search": { body: { results: [1, 2, 3] } } });

    setPanelModuleLoader(async () => fixture);
    render(<PanelHost id="test" title="Test" route="" />);

    expect(await screen.findByRole("heading", { name: "Test panel" })).toBeInTheDocument();
    expect(api.calls[0]?.url).toBe("api/test/search?q=a");
  });

  it("passes the context members, the route, and renders again on refresh and route change", async () => {
    let seen: LegacyPanelContext | undefined;
    let runs = 0;

    setPanelModuleLoader(async () => ({
      default(context) {
        seen = context;
        runs += 1;
        context.root.append(context.el("p", { text: `route=${context.route} run=${runs}` }));
      },
    }));

    const { rerender } = render(<PanelHost id="book" title="Book" route="flow/a" />);

    expect(await screen.findByText("route=flow/a run=1")).toBeInTheDocument();
    expect(seen?.id).toBe("book");
    // Absolute, so a view can `import()` it: a bare relative path is a module specifier import() refuses.
    expect(seen?.asset("graph.js")).toBe(new URL("panels/book/graph.js", document.baseURI).href);
    expect(seen?.asset("graph.js")).toMatch(/^https?:\/\//);
    expect(seen?.href("flow/b")).toBe("#book/flow/b");
    expect(seen?.href()).toBe("#book");
    expect(seen?.empty("Nothing").className).toBe("empty");
    expect(seen?.svg("circle", { r: 3 }).namespaceURI).toBe("http://www.w3.org/2000/svg");

    seen?.refresh();
    expect(await screen.findByText("route=flow/a run=2")).toBeInTheDocument();

    rerender(<PanelHost id="book" title="Book" route="flow/b" />);
    expect(await screen.findByText("route=flow/b run=3")).toBeInTheDocument();
    expect(screen.queryByText("route=flow/a run=2")).not.toBeInTheDocument();
  });

  it("gives a normal mount file(), shared false and the share value it was given", async () => {
    let seen: LegacyPanelContext | undefined;

    setPanelModuleLoader(async () => ({
      default(context) {
        seen = context;
        context.root.append(context.el("p", { text: "ready" }));
      },
    }));

    const share = { enabled: true, manageHref: "#/admin/shares?panel=book" };

    render(<PanelHost id="book" title="Book" route="" share={share} />);
    await screen.findByText("ready");

    expect(seen?.shared).toBe(false);
    expect(seen?.share).toEqual(share);
    expect(seen?.file("a b/shot.png")).toBe(
      new URL("panels/book/files/a%20b/shot.png", document.baseURI).href,
    );
  });

  it("gives share null when the panel cannot be shared", async () => {
    let seen: LegacyPanelContext | undefined;

    setPanelModuleLoader(async () => ({
      default(context) {
        seen = context;
        context.root.append(context.el("p", { text: "ready" }));
      },
    }));
    mockApi({ "api/book/flows/a": { body: {} } });
    render(<PanelHost id="book" title="Book" route="" />);
    await screen.findByText("ready");

    expect(seen?.share).toBeNull();
  });

  it("navigate sets the hash, or refreshes when it is already there", async () => {
    let seen: LegacyPanelContext | undefined;
    let runs = 0;

    setPanelModuleLoader(async () => ({
      default(context) {
        seen = context;
        runs += 1;
        context.root.append(context.el("p", { text: `run ${runs}` }));
      },
    }));
    render(<PanelHost id="book" title="Book" route="" />);
    await screen.findByText("run 1");

    seen?.navigate("x/y");
    expect(window.location.hash).toBe("#book/x/y");

    seen?.navigate("x/y");
    expect(await screen.findByText("run 2")).toBeInTheDocument();
  });

  it("sends the CSRF header on writes only and returns JSON; throws Error(message) on failure", async () => {
    const api = mockApi({
      "api/book/read": { body: { ok: true } },
      "POST api/book/write": { body: { saved: 1 } },
      "POST api/book/bad": { status: 422, body: { error: "The flow name is empty. Type a name." } },
      "POST api/book/broken": {
        status: 500,
        body: { error: "The book file is read-only.", ref: "K7P2QX9M" },
      },
      "DELETE api/book/gone": { status: 204 },
    });
    let seen: LegacyPanelContext | undefined;

    setCsrfToken("csrf-xyz");
    setPanelModuleLoader(async () => ({ default: (context) => void (seen = context) }));
    render(<PanelHost id="book" title="Book" route="" />);
    await waitFor(() => expect(seen).toBeDefined());

    await expect(seen?.api("read")).resolves.toEqual({ ok: true });
    await expect(seen?.api("write", { method: "POST", body: "{}" })).resolves.toEqual({ saved: 1 });
    await expect(seen?.api("bad", { method: "POST" })).rejects.toThrow(
      "The flow name is empty. Type a name.",
    );
    await expect(seen?.api("broken", { method: "POST" })).rejects.toMatchObject({
      message: "The book file is read-only.",
      status: 500,
      ref: "K7P2QX9M",
    });
    await expect(seen?.api("bad", { method: "POST" })).rejects.toMatchObject({
      status: 422,
      ref: null,
    });
    await expect(seen?.api("gone", { method: "DELETE" })).resolves.toBeUndefined();

    const header = (method: string) =>
      api.calls.find((call) => call.method === method)?.headers.get("X-Devtools-Csrf");

    expect(header("GET")).toBeNull();
    expect(header("POST")).toBe("csrf-xyz");
    expect(header("DELETE")).toBe("csrf-xyz");
  });

  it("shows an error that says what to check when the module has no default export", async () => {
    setPanelModuleLoader(async () => ({}));
    render(<PanelHost id="book" title="Book" route="" />);

    expect(
      await screen.findByText(/Book panel's view module has no default export function/),
    ).toBeInTheDocument();
  });

  it("shows an error when the module fails to load, and retries on the next mount", async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error("404 view.js"))
      .mockResolvedValue({
        default: (context: LegacyPanelContext) => void context.root.append(context.empty("Loaded")),
      });

    setPanelModuleLoader(loader);

    const first = render(<PanelHost id="book" title="Book" route="" />);

    expect(
      await screen.findByText(
        /Book panel's view module did not load \(404 view.js\)\. Check the server log\./,
      ),
    ).toBeInTheDocument();
    first.unmount();

    render(<PanelHost id="book" title="Book" route="" />);
    expect(await screen.findByText("Loaded")).toBeInTheDocument();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("shows a thrown view error", async () => {
    setPanelModuleLoader(async () => ({
      default() {
        throw new Error("The graph file is missing. Reinstall the panel package.");
      },
    }));
    render(<PanelHost id="book" title="Book" route="" />);

    expect(await screen.findByText(/graph file is missing/)).toBeInTheDocument();
  });
});
