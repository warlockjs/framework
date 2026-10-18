import { PAGE_INVALIDATED_EVENT, type LivePageOptions } from "../../live-page-data";
import { hasDirtyForms, subscribeDirtyForms } from "./dirty-form-store";
import { readNavigationPending, subscribeNavigationPending } from "./navigation-pending-store";
import { clearPrefetchCache } from "./prefetch";

/** Structural subset of a Socket.IO client; the application owns its lifecycle. */
export type LivePageSocket = {
  readonly connected: boolean;
  on(event: string, listener: (payload?: unknown) => void): unknown;
  off(event: string, listener: (payload?: unknown) => void): unknown;
};

let configuredSocket: LivePageSocket | undefined;
const configurationListeners = new Set<() => void>();

/** Reuse the app's default-namespace Socket.IO client; omit socket for polling. */
export function configureLivePageData(options: { socket?: LivePageSocket }): void {
  configuredSocket = options.socket;
  for (const listener of configurationListeners) listener();
}

/** One controller per mounted navigation runtime, across page swaps. */
export function startLivePageData(runtime: {
  readOptions: () => LivePageOptions | undefined;
  refresh: () => Promise<boolean>;
}): () => void {
  let disposed = false;
  let running = false;
  const queuedTags = new Set<string>();
  let pollQueued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachSocket: (() => void) | undefined;

  const drain = async (): Promise<void> => {
    if (disposed || running || readNavigationPending() || hasDirtyForms()) return;
    const options = runtime.readOptions();
    const tags = [...queuedTags];
    const shouldRefresh = options && (pollQueued || tags.some((tag) => options.tags.includes(tag)));
    queuedTags.clear();
    const polled = pollQueued;
    pollQueued = false;
    if (!shouldRefresh) return;

    running = true;
    let applied = false;
    try {
      applied = await runtime.refresh();
    } catch {
      // A failed background refresh keeps the current page and retries later.
    } finally {
      running = false;
      if (disposed) return;
      if (!applied) {
        for (const tag of tags) queuedTags.add(tag);
        pollQueued ||= polled;
      }
      // Events received during the request need another pass, but failures
      // must wait for a new event, an idle/clean transition, or the next tick.
      if (applied) void drain();
    }
  };

  const schedulePoll = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    if (disposed) return;
    timer = setTimeout(() => {
      if (!configuredSocket?.connected) {
        pollQueued = true;
        void drain();
      }
      schedulePoll();
    }, runtime.readOptions()?.pollInterval ?? 30_000);
  };

  const wake = (): void => {
    void drain();
    schedulePoll();
  };

  const onInvalidation = (payload?: unknown): void => {
    if (typeof payload !== "object" || payload === null) return;
    const tags = (payload as Record<string, unknown>).tags;
    if (!Array.isArray(tags) || !tags.every((tag: unknown) => typeof tag === "string")) return;
    clearPrefetchCache();
    // Ignore unrelated tags immediately; only dependencies of the page on
    // screen can be deferred while a navigation or form holds the guard.
    const options = runtime.readOptions();
    for (const tag of tags) if (options?.tags.includes(tag)) queuedTags.add(tag);
    void drain();
  };

  const onConnect = (): void => {
    // Socket.IO broadcasts are not durable. Catch up after an offline gap.
    pollQueued = true;
    wake();
  };

  const bindSocket = (): void => {
    detachSocket?.();
    const socket = configuredSocket;
    socket?.on(PAGE_INVALIDATED_EVENT, onInvalidation);
    socket?.on("connect", onConnect);
    socket?.on("disconnect", wake);
    detachSocket = () => {
      socket?.off(PAGE_INVALIDATED_EVENT, onInvalidation);
      socket?.off("connect", onConnect);
      socket?.off("disconnect", wake);
    };
    wake();
  };

  const unsubscribeNavigation = subscribeNavigationPending(wake);
  const unsubscribeDirty = subscribeDirtyForms(wake);
  configurationListeners.add(bindSocket);
  bindSocket();

  return () => {
    disposed = true;
    if (timer !== undefined) clearTimeout(timer);
    detachSocket?.();
    configurationListeners.delete(bindSocket);
    unsubscribeNavigation();
    unsubscribeDirty();
  };
}
