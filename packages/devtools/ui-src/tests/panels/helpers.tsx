import { render } from "@testing-library/react";
import { useState, type ComponentType } from "react";
import { vi } from "vitest";
import type { DevtoolsInstanceInfo, DevtoolsSessionView } from "@contracts";
import type { DevtoolsPanelProps } from "@/panels/types";

export const instanceA: DevtoolsInstanceInfo = {
  id: "web-1:100:abc",
  label: "web-1 #0",
  host: "web-1",
  pid: 100,
  worker: "0",
  startedAt: 1_700_000_000_000,
  seenAt: 1_700_000_100_000,
  nodeVersion: "v22.13.0",
};

export const instanceB: DevtoolsInstanceInfo = { ...instanceA, id: "web-2:200:def", label: "web-2 #1", host: "web-2", pid: 200, worker: "1" };

function session(overrides: Partial<DevtoolsSessionView>): DevtoolsSessionView {
  return {
    mode: "development",
    stage: "active",
    account: null,
    role: "admin",
    csrf: null,
    expiresAt: null,
    instance: instanceA,
    methods: null,
    ...overrides,
  };
}

export const devSession = session({});
export const prodAdmin = session({ mode: "production", csrf: "token" });
export const prodViewer = session({ mode: "production", role: "viewer", csrf: "token" });

type Answer = unknown | ((url: string, init: RequestInit | undefined) => unknown);
type Route = [match: string | RegExp, answer: Answer, method?: string];

export type ApiCall = { url: string; method: string; body: unknown };

/** An error answer in the API's JSON shape. */
export function failure(status: number, error: string, extra: Record<string, unknown> = {}) {
  return { __status: status, body: { error, code: "server.error", ...extra } };
}

/**
 * Replaces `fetch` with an in-memory API. Routes are tried in order; a
 * string matches the URL exactly (or `METHOD url` when a method is given), a
 * RegExp matches anywhere in it. Unmatched calls answer a bare 404.
 */
export function mockApi(routes: Route[]) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    for (const [match, answer, routeMethod] of routes) {
      if ((routeMethod ?? "GET") !== method) continue;

      const hit = typeof match === "string" ? match === url : match.test(url);

      if (!hit) continue;

      const value = typeof answer === "function" ? (answer as (u: string, i?: RequestInit) => unknown)(url, init) : answer;

      if (value && typeof value === "object" && "__status" in value) {
        const { __status, body } = value as { __status: number; body: unknown };

        return { ok: false, status: __status, json: async () => body } as Response;
      }

      return value === undefined
        ? ({ ok: true, status: 204, json: async () => undefined } as Response)
        : ({ ok: true, status: 200, json: async () => value } as Response);
    }

    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });

  vi.stubGlobal("fetch", fetchMock);

  return { calls, fetchMock };
}

export class FakeEventSource {
  public static instances: FakeEventSource[] = [];
  private readonly listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  public closed = false;

  public constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  public addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  public close(): void {
    this.closed = true;
  }

  public emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent<string>);
    }
  }

  public static install(): void {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  }

  public static latest(): FakeEventSource {
    const found = FakeEventSource.instances.at(-1);

    if (!found) throw new Error("No EventSource was opened");

    return found;
  }
}

/** Renders a tab with a working `route`/`navigate` pair, like the shell's. */
export function renderPanel(
  Panel: ComponentType<DevtoolsPanelProps>,
  options: { session?: DevtoolsSessionView; route?: string; instance?: string } = {},
) {
  const navigations: string[] = [];

  function Harness() {
    const [route, setRoute] = useState(options.route ?? "");

    return (
      <Panel
        route={route}
        navigate={(next) => {
          navigations.push(next);
          setRoute(next);
        }}
        instance={options.instance ?? "all"}
        session={options.session ?? devSession}
      />
    );
  }

  return { ...render(<Harness />), navigations };
}
