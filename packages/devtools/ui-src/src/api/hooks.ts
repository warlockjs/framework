import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, apiFetch } from "./client";

/**
 * Data hooks shared by every tab.
 */

export type ApiState<T> = {
  data: T | undefined;
  error: ApiError | undefined;
  /** True while a fetch is running, background refreshes included: show a skeleton only when `data` is undefined. */
  loading: boolean;
  /** Fetches again now. */
  reload: () => void;
};

/**
 * GETs `path` (relative to the dashboard root) and again every `refreshMs`
 * while the page is visible. `path === null` fetches nothing. A new `path`
 * refetches; stale answers are dropped.
 */
export function useApi<T>(path: string | null, options: { refreshMs?: number } = {}): ApiState<T> {
  const [tick, setTick] = useState(0);
  const [result, setResult] = useState<{
    key: string | null;
    data: T | undefined;
    error: ApiError | undefined;
  }>({ key: null, data: undefined, error: undefined });
  const reload = useCallback(() => setTick((value) => value + 1), []);
  const key = path === null ? null : `${path}#${tick}`;

  useEffect(() => {
    if (key === null || path === null) return;

    const controller = new AbortController();

    apiFetch<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: undefined });
      },
      (reason: unknown) => {
        if (controller.signal.aborted) return;

        const error = reason instanceof ApiError ? reason : new ApiError(String(reason), 0);

        setResult((previous) => ({ key, data: previous.data, error }));
      },
    );

    return () => controller.abort();
  }, [key, path]);

  useInterval(reload, path === null ? null : (options.refreshMs ?? null));

  return {
    data: result.data,
    error: result.error,
    loading: key !== null && result.key !== key,
    reload,
  };
}

/** Calls `callback` every `ms` while the document is visible; `null` stops it. */
export function useInterval(callback: () => void, ms: number | null): void {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (ms === null) return;

    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") saved.current();
    }, ms);

    return () => clearInterval(id);
  }, [ms]);
}

/** A live stream event. */
export type StreamEvent = { type: string; data: unknown };

/**
 * Subscribes to `api/stream` (server-sent events) for `types`. Reconnects
 * with backoff (1 s doubling to 30 s) after an error.
 */
export function useStream(types: readonly string[], onEvent: (event: StreamEvent) => void): void {
  const saved = useRef(onEvent);
  const key = types.join(",");

  useEffect(() => {
    saved.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;

    let source: EventSource | null = null;
    let delay = 1000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      const current = new EventSource("api/stream");

      source = current;
      current.addEventListener("open", () => {
        delay = 1000;
      });
      current.addEventListener("error", () => {
        current.close();

        if (closed) return;

        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      });

      for (const type of key.split(",")) {
        if (!type) continue;

        current.addEventListener(type, (event) => {
          try {
            saved.current({ type, data: JSON.parse((event as MessageEvent<string>).data) });
          } catch {
            // A malformed frame is ignored.
          }
        });
      }
    };

    connect();

    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [key]);
}
