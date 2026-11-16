import config from "@mongez/config";
import type { Request, Response } from "@warlock.js/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { earlyHintLinks, sendEarlyHints } from "./early-hints";

function pair(options: { httpVersion?: string; headersSent?: boolean; support?: boolean } = {}) {
  const writeEarlyHints = vi.fn();
  const raw = {
    headersSent: options.headersSent ?? false,
    ...(options.support === false ? {} : { writeEarlyHints }),
  };
  const request = {
    baseRequest: { raw: { httpVersion: options.httpVersion ?? "1.1" } },
  } as unknown as Request;
  const response = { raw } as unknown as Response;

  return { request, response, writeEarlyHints };
}

afterEach(() => {
  config.set("web", {});
});

describe("earlyHintLinks", () => {
  it("preloads the entry and its chunks as modules and the stylesheets as styles", () => {
    expect(
      earlyHintLinks({
        hydrationClientModuleUrl: "/assets/entry.js",
        hydrationClientModulePreloadUrls: ["/assets/vendor-react.js", "/assets/entry.js"],
        stylesheetUrls: ["/assets/app.css"],
      }),
    ).toEqual([
      "</assets/entry.js>; rel=modulepreload",
      "</assets/vendor-react.js>; rel=modulepreload",
      "</assets/app.css>; rel=preload; as=style",
    ]);
  });

  it("marks a cross-origin asset crossorigin and drops a URL that could break out of the header", () => {
    expect(
      earlyHintLinks({
        hydrationClientModuleUrl: "https://cdn.test/entry.js",
        stylesheetUrls: ["/bad>.css", "/ok.css\\r\\nX-Evil: 1"],
      }),
    ).toEqual(["<https://cdn.test/entry.js>; rel=modulepreload; crossorigin"]);
  });

  it("is empty when the page has nothing to preload", () => {
    expect(earlyHintLinks({})).toEqual([]);
  });
});

describe("sendEarlyHints", () => {
  const links = ["</entry.js>; rel=modulepreload"];

  it("sends nothing unless web.earlyHints is on", () => {
    const { request, response, writeEarlyHints } = pair();

    expect(sendEarlyHints(request, response, links)).toBe(false);
    expect(writeEarlyHints).not.toHaveBeenCalled();
  });

  it("writes one 103 with the links when the app opted in", () => {
    config.set("web", { earlyHints: true });
    const { request, response, writeEarlyHints } = pair();

    expect(sendEarlyHints(request, response, links)).toBe(true);
    expect(writeEarlyHints).toHaveBeenCalledWith({ link: links });
  });

  it("skips an HTTP/1.0 client, a sent response, a runtime without support and an empty list", () => {
    config.set("web", { earlyHints: true });

    for (const options of [{ httpVersion: "1.0" }, { headersSent: true }, { support: false }]) {
      const { request, response, writeEarlyHints } = pair(options);

      expect(sendEarlyHints(request, response, links)).toBe(false);
      expect(writeEarlyHints).not.toHaveBeenCalled();
    }

    const { request, response } = pair();

    expect(sendEarlyHints(request, response, [])).toBe(false);
  });

  it("never throws when the runtime rejects the hint", () => {
    config.set("web", { earlyHints: true });
    const { request, response, writeEarlyHints } = pair();

    writeEarlyHints.mockImplementation(() => {
      throw new Error("socket closed");
    });

    expect(sendEarlyHints(request, response, links)).toBe(false);
  });
});
