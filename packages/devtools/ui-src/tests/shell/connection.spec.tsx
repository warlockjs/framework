import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app/App";
import { reportFailure, resetConnection } from "@/api/connection";
import { developmentSession } from "../helpers/api";

vi.mock("@/panels/registry", async () => (await import("../helpers/fake-panels")).fakeRegistry());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("connection banner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetConnection();
    vi.useRealTimers();
  });

  it("shows Reconnecting with elapsed time, backs off, then Reconnected and refetches", async () => {
    let up = false;
    const panelCalls: number[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (!up && url !== "api/panels") throw new TypeError("network down");
      if (url === "api/panels") {
        panelCalls.push(Date.now());

        if (!up) throw new TypeError("network down");

        return json([{ id: "requests", title: "Requests", type: "built-in", shareable: false }]);
      }

      return json(developmentSession);
    });

    up = true;
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(screen.queryByTestId("connection-banner")).not.toBeInTheDocument();
    const before = panelCalls.length;

    up = false;
    act(() => reportFailure());
    expect(screen.getByTestId("connection-banner")).toHaveTextContent("Reconnecting to the app…");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(screen.getByTestId("connection-banner")).toHaveTextContent(
      /Reconnecting to the app…\s*3 s/,
    );
    // Probes back off (1 s, then 2 s): at most 2 by now, and no error text reached the page.
    const probes = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "api/auth/session",
    ).length;

    expect(probes).toBeLessThanOrEqual(3);
    expect(screen.queryByText(/could not reach/i)).not.toBeInTheDocument();

    up = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId("connection-banner")).toHaveTextContent("Reconnected");
    expect(panelCalls.length).toBeGreaterThan(before);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(screen.queryByTestId("connection-banner")).not.toBeInTheDocument();
  });
});
