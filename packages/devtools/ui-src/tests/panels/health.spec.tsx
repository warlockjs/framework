import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DevtoolsHealthView } from "@contracts";
import { HealthPanel } from "@/panels/health";
import { failure, instanceA, instanceB, mockApi, prodViewer, renderPanel } from "./helpers";

const view: DevtoolsHealthView = {
  instances: [
    {
      instance: instanceA,
      report: {
        status: "ok",
        checkedAt: Date.now() - 4000,
        checks: { database: true, cache: true },
        history: [{ at: 1000, status: "ok", failed: [] }],
      },
    },
    {
      instance: instanceB,
      report: {
        status: "error",
        checkedAt: Date.now() - 4000,
        checks: { database: false },
        history: [
          { at: 1000, status: "ok", failed: [] },
          { at: 2000, status: "error", failed: ["database"] },
        ],
      },
    },
  ],
};

describe("Health panel", () => {
  it("renders status, each check and the history strip per instance", async () => {
    mockApi([[/^api\/health/, view]]);
    renderPanel(HealthPanel, { session: prodViewer });

    expect(await screen.findByText("web-1 #0")).toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("failing")).toBeInTheDocument();
    expect(screen.getAllByText("passing")).toHaveLength(2);

    const strips = screen.getAllByLabelText("Health history, oldest first");

    expect(within(strips[1] as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the empty state", async () => {
    mockApi([[/^api\/health/, { instances: [] }]]);
    renderPanel(HealthPanel);

    expect(
      await screen.findByText(/No instance has reported a health check yet/),
    ).toBeInTheDocument();
  });

  it("shows an API error with message and ref", async () => {
    mockApi([
      [
        /^api\/health/,
        failure(500, "Health could not be read. Try again in a moment.", { ref: "h-1" }),
      ],
    ]);
    renderPanel(HealthPanel);

    expect(
      await screen.findByText("Health could not be read. Try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reference: h-1")).toBeInTheDocument();
  });
});
