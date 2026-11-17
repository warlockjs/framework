import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { DevtoolsLogRow } from "@contracts";
import { LogsPanel } from "@/panels/logs";
import {
  devSession,
  failure,
  FakeEventSource,
  instanceA,
  mockApi,
  prodViewer,
  renderPanel,
} from "./helpers";

const log = (overrides: Partial<DevtoolsLogRow> = {}): DevtoolsLogRow => ({
  level: "warn",
  module: "payments",
  action: "retry",
  message: "Gateway timed out",
  at: Date.now() - 60_000,
  requestId: null,
  instance: null,
  ...overrides,
});

beforeEach(() => FakeEventSource.install());

describe("Logs panel", () => {
  it("renders rows with a context viewer in development", async () => {
    mockApi([[/^api\/logs/, [log({ context: { orderId: 9 } })]]]);
    renderPanel(LogsPanel, { session: devSession });

    expect(await screen.findByText("Gateway timed out")).toBeInTheDocument();
    expect(screen.getByText("Context")).toBeInTheDocument();
    expect(screen.getByText(/"orderId": 9/)).toBeInTheDocument();
  });

  it("shows the instance and no context in production", async () => {
    mockApi([
      [/^api\/logs/, [log({ instance: instanceA.id, requestId: "req-2" })]],
      ["api/instances", { current: instanceA.id, instances: [instanceA] }],
    ]);
    renderPanel(LogsPanel, { session: prodViewer });

    expect(await screen.findByText("web-1 #0")).toBeInTheDocument();
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "request" })).toHaveAttribute(
      "href",
      "#requests/req-2",
    );
  });

  it("filters by level and module through the server", async () => {
    const { calls } = mockApi([[/^api\/logs/, []]]);
    const user = userEvent.setup();

    renderPanel(LogsPanel);
    await screen.findByText(/No logs found/);
    await user.selectOptions(screen.getByLabelText("Level"), "error");
    await user.type(screen.getByLabelText("Filter module"), "db");

    expect(calls.some((call) => call.url === "api/logs?level=error&module=db")).toBe(true);
  });

  it("puts a live log event on top", async () => {
    mockApi([[/^api\/logs/, [log()]]]);
    renderPanel(LogsPanel);
    await screen.findByText("Gateway timed out");

    act(() =>
      FakeEventSource.latest().emit("log", log({ message: "Fresh entry", at: Date.now() })),
    );

    const fresh = await screen.findByText("Fresh entry");

    expect(
      fresh.compareDocumentPosition(screen.getByText("Gateway timed out")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows the empty state and API errors", async () => {
    mockApi([[/^api\/logs/, failure(500, "Logs could not be read. Try again.", { ref: "lg-1" })]]);
    renderPanel(LogsPanel);

    expect(await screen.findByText("Logs could not be read. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Reference: lg-1")).toBeInTheDocument();
  });
});
