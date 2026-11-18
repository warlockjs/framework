import { act, screen, within } from "@testing-library/react";
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
    await user.click(
      within(screen.getByRole("group", { name: "Level" })).getByRole("button", { name: "error" }),
    );
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

describe("Logs panel summary and counts", () => {
  it("shows tiles and narrows the loaded rows by message", async () => {
    mockApi([
      [
        /^api\/logs/,
        [
          log(),
          log({ level: "error", message: "Disk full", module: "storage", at: Date.now() - 30_000 }),
        ],
      ],
    ]);
    const user = userEvent.setup();

    renderPanel(LogsPanel);

    const summary = await screen.findByLabelText("Summary");

    expect(within(summary).getByText("Errors")).toBeInTheDocument();
    expect(within(summary).getByText("Warnings")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 entries");

    await user.type(screen.getByLabelText("Search messages"), "disk");

    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 entries");
    expect(screen.queryByText("Gateway timed out")).not.toBeInTheDocument();
    expect(screen.getByText("Disk full")).toBeInTheDocument();
  });
});
