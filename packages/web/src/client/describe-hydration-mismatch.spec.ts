// @vitest-environment jsdom
import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeHydrationMismatch, formatHydrationMismatch } from "./describe-hydration-mismatch";
import { logHydrationMismatchInDevelopment } from "./hydrate-page";

const LINK = "https://react.dev/link/hydration-mismatch";

describe("describeHydrationMismatch", () => {
  it("reads the first text mismatch and the element path above it", () => {
    const message = `Hydration failed because the server rendered text didn't match the client.\n\n${LINK}\n\n  <main>\n    <ul>\n      <li>\n+       Hong Kong\n-       Hong Kong SAR China\n`;

    expect(describeHydrationMismatch(message)).toEqual({
      path: "main > ul > li",
      client: "Hong Kong",
      server: "Hong Kong SAR China",
    });
  });

  it("returns undefined when the message has no diff", () => {
    expect(describeHydrationMismatch("Minified React error #418")).toBeUndefined();
    expect(describeHydrationMismatch(`text\n${LINK}`)).toBeUndefined();
  });

  it("formats server and client text with the Intl hint", () => {
    const output = formatHydrationMismatch({ path: "ul > li", client: "a", server: "b" });

    expect(output).toContain("ul > li");
    expect(output).toContain("Server: b");
    expect(output).toContain("Client: a");
    expect(output).toContain("Intl");
  });
});

describe("hydration mismatch logging", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("names the mismatching text node of a real React hydration error", async () => {
    const App = ({ label }: { label: string }) =>
      createElement("main", null, createElement("ul", null, createElement("li", null, label)));
    const container = document.createElement("div");
    container.innerHTML = renderToString(createElement(App, { label: "server text" }));
    document.body.append(container);

    const errors: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});

    await act(async () => {
      root = hydrateRoot(container, createElement(App, { label: "client text" }), {
        onRecoverableError: (error) => errors.push(error),
      });
    });

    expect(errors.length).toBeGreaterThan(0);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logHydrationMismatchInDevelopment(errors[0]);

    expect(warn).toHaveBeenCalledTimes(1);

    const output = String(warn.mock.calls[0]?.[0]);

    expect(output).toContain("main > ul > li");
    expect(output).toContain("Server: server text");
    expect(output).toContain("Client: client text");
  });

  it("logs nothing for an error without a diff", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logHydrationMismatchInDevelopment(new Error("unrelated"));
    logHydrationMismatchInDevelopment("not an error");

    expect(warn).not.toHaveBeenCalled();
  });

  it("logs nothing outside development", () => {
    vi.stubEnv("DEV", false);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logHydrationMismatchInDevelopment(new Error(`x\n\n${LINK}\n\n  <p>\n+   a\n-   b\n`));

    expect(warn).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
