import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  beginNavigationPending,
  readNavigationPending,
  subscribeNavigationPending,
  waitForNavigationIdle,
} from "./navigation-pending-store";
import { useIsNavigating } from "./use-is-navigating";

describe("navigation pending ticket store", () => {
  it("keeps a replacement ticket pending when the superseded ticket completes", () => {
    const first = beginNavigationPending();
    const second = beginNavigationPending();

    first();
    expect(readNavigationPending()).toBe(true);

    second();
    expect(readNavigationPending()).toBe(false);
  });

  it("does not emit a false pulse while a new ticket replaces the current one", () => {
    const changes: boolean[] = [];
    const unsubscribe = subscribeNavigationPending(() => changes.push(readNavigationPending()));
    const first = beginNavigationPending();
    const second = beginNavigationPending();

    first();
    second();
    unsubscribe();

    expect(changes).toEqual([true, false]);
  });

  it("uses the constant false server snapshot even while a client ticket exists", () => {
    const complete = beginNavigationPending();
    const Probe = () => createElement("span", null, String(useIsNavigating()));

    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>false</span>");

    complete();
  });
});

describe("waitForNavigationIdle", () => {
  it("resolves at once when nothing is pending", async () => {
    await expect(waitForNavigationIdle()).resolves.toBeUndefined();
  });

  it("waits through a replacement ticket and resolves when the last one completes", async () => {
    const first = beginNavigationPending();
    let settled = false;
    const idle = waitForNavigationIdle().then(() => {
      settled = true;
    });
    const second = beginNavigationPending();

    first();
    await Promise.resolve();
    expect(settled).toBe(false);

    second();
    await idle;
    expect(settled).toBe(true);
  });
});
