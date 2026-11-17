import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { DevtoolsErrorsView } from "@contracts";
import { ErrorsPanel } from "@/panels/errors";
import { devSession, failure, instanceA, mockApi, prodViewer, renderPanel } from "./helpers";

const view = (): DevtoolsErrorsView => ({
  groups: [
    {
      id: "e1",
      message: "Cannot read properties of undefined",
      name: "TypeError",
      source: "request",
      route: "GET /posts/:slug",
      status: 500,
      count: 17,
      firstSeen: Date.now() - 3_600_000,
      lastSeen: Date.now() - 10_000,
      lastRequestId: "req-5",
      stack: "TypeError: Cannot read\n    at handler (posts.ts:10)",
      instances: [instanceA.id],
    },
    {
      id: "e2",
      message: "disk almost full",
      name: null,
      source: "log",
      route: null,
      status: null,
      count: 1,
      firstSeen: 1,
      lastSeen: 2,
      lastRequestId: null,
      stack: null,
      instances: [],
    },
  ],
});

describe("Errors panel", () => {
  it("renders groups with counts and expands a stack with a link to the last request", async () => {
    mockApi([
      [/^api\/errors/, view()],
      ["api/instances", { current: instanceA.id, instances: [instanceA] }],
    ]);
    const user = userEvent.setup();

    renderPanel(ErrorsPanel, { session: prodViewer });
    await user.click(
      await screen.findByRole("button", { name: "Cannot read properties of undefined" }),
    );

    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("web-1 #0")).toBeInTheDocument();
    expect(screen.getByText(/at handler \(posts.ts:10\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the last request" })).toHaveAttribute(
      "href",
      "#requests/req-5",
    );
  });

  it("says when a group has no stack", async () => {
    mockApi([[/^api\/errors/, view()]]);
    const user = userEvent.setup();

    renderPanel(ErrorsPanel, { session: devSession });
    await user.click(await screen.findByRole("button", { name: "disk almost full" }));

    expect(screen.getByText("No stack was available for this error.")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockApi([[/^api\/errors/, { groups: [] }]]);
    renderPanel(ErrorsPanel, { session: devSession });

    expect(await screen.findByText(/No errors recorded/)).toBeInTheDocument();
  });

  it("shows an API error with message and ref", async () => {
    mockApi([
      [/^api\/errors/, failure(500, "Errors could not be read. Try again.", { ref: "er-1" })],
    ]);
    renderPanel(ErrorsPanel, { session: devSession });

    expect(await screen.findByText("Errors could not be read. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Reference: er-1")).toBeInTheDocument();
  });
});
