import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LivePageOptions } from "../../live-page-data";
import { configureLivePageData, startLivePageData, type LivePageSocket } from "./live-page-data";
import { beginNavigationPending } from "./navigation-pending-store";
import { setFormDirty } from "./dirty-form-store";

class Socket implements LivePageSocket {
  connected = true;
  listeners = new Map<string, Set<(payload?: unknown) => void>>();
  on(event: string, listener: (payload?: unknown) => void) {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
  }
  off(event: string, listener: (payload?: unknown) => void) {
    this.listeners.get(event)?.delete(listener);
  }
  emit(event: string, payload?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }
  invalidate(tags = ["products"]) {
    this.emit("warlock:page-invalidated", { tags });
  }
}

const form = {};
let stop: (() => void) | undefined;
let completeNavigation: (() => void) | undefined;
let options: LivePageOptions | undefined;
let socket: Socket;
let refresh: ReturnType<typeof vi.fn<() => Promise<boolean>>>;

beforeEach(() => {
  vi.useFakeTimers();
  options = { tags: ["products"], pollInterval: 1000 };
  socket = new Socket();
  refresh = vi.fn(async () => true);
  configureLivePageData({ socket });
});

afterEach(() => {
  stop?.();
  completeNavigation?.();
  completeNavigation = undefined;
  setFormDirty(form, false);
  configureLivePageData({});
  vi.useRealTimers();
});

function start() {
  stop = startLivePageData({ readOptions: () => options, refresh });
}

describe("live page scheduling", () => {
  it("refreshes matching tags, ignoring unrelated or malformed events", async () => {
    start();
    socket.invalidate(["other"]);
    socket.emit("warlock:page-invalidated", { tags: [null] });
    expect(refresh).not.toHaveBeenCalled();
    socket.invalidate();
    await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("coalesces notifications during navigation and rechecks the committed page", () => {
    start();
    completeNavigation = beginNavigationPending();
    socket.invalidate();
    socket.invalidate();
    expect(refresh).not.toHaveBeenCalled();
    options = { tags: ["other"] };
    completeNavigation();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("waits for navigation to finish before refreshing a still-matching page", () => {
    start();
    completeNavigation = beginNavigationPending();
    socket.invalidate();
    expect(refresh).not.toHaveBeenCalled();
    completeNavigation();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("coalesces invalidations until every dirty form clears", () => {
    const secondForm = {};
    start();
    setFormDirty(form, true);
    setFormDirty(secondForm, true);
    socket.invalidate();
    socket.invalidate();
    setFormDirty(form, false);
    expect(refresh).not.toHaveBeenCalled();
    setFormDirty(secondForm, false);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("polls without a socket, pauses for edits, and catches up when clean", async () => {
    configureLivePageData({});
    start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    setFormDirty(form, true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(refresh).toHaveBeenCalledTimes(1);
    setFormDirty(form, false);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("stops polling while connected and catches up on reconnect", async () => {
    start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(refresh).not.toHaveBeenCalled();
    socket.connected = false;
    socket.emit("disconnect");
    await vi.advanceTimersByTimeAsync(1000);
    expect(refresh).toHaveBeenCalledTimes(1);
    socket.connected = true;
    socket.emit("connect");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("retains invalidations if editing begins during a refresh", async () => {
    let resolveRefresh: (applied: boolean) => void = () => {};
    refresh.mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    start();
    socket.invalidate();
    setFormDirty(form, true);
    resolveRefresh(false);
    await Promise.resolve();
    refresh.mockResolvedValue(true);
    setFormDirty(form, false);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("removes listeners and timers on disposal or socket replacement", async () => {
    start();
    const replacement = new Socket();
    configureLivePageData({ socket: replacement });
    socket.invalidate();
    expect(refresh).not.toHaveBeenCalled();
    stop?.();
    replacement.invalidate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).not.toHaveBeenCalled();
    expect([...replacement.listeners.values()].every((listeners) => listeners.size === 0)).toBe(
      true,
    );
  });
});
