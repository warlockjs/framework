import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DevtoolsJobsView } from "@contracts";
import { JobsPanel } from "@/panels/jobs";
import { failure, instanceA, instanceB, mockApi, prodViewer, renderPanel } from "./helpers";

const view: DevtoolsJobsView = {
  instances: [
    {
      instance: instanceA,
      report: {
        available: { scheduler: true, queue: true },
        schedules: [
          {
            name: "send-digest",
            cron: "0 8 * * *",
            interval: null,
            isRunning: true,
            lastRunAt: Date.now() - 3_600_000,
            nextRunAt: Date.now() + 3_600_000,
            lastDurationMs: 1500,
            lastError: "SMTP refused",
            runs: 30,
            failures: 2,
          },
        ],
        queues: [{ name: "emails", counts: { waiting: 4, failed: 1 } }],
      },
    },
    {
      instance: instanceB,
      report: { available: { scheduler: false, queue: false }, schedules: [], queues: [] },
    },
  ],
};

describe("Jobs panel", () => {
  it("renders schedules and queue counts per instance", async () => {
    mockApi([[/^api\/jobs/, view]]);
    renderPanel(JobsPanel, { session: prodViewer });

    const schedules = await screen.findByRole("table", { name: "Schedules" });

    expect(within(schedules).getByText("send-digest")).toBeInTheDocument();
    expect(within(schedules).getByText("0 8 * * *")).toBeInTheDocument();
    expect(within(schedules).getByText("SMTP refused")).toBeInTheDocument();
    expect(within(schedules).getByText("running")).toBeInTheDocument();

    const queues = screen.getByRole("table", { name: "Queues" });

    expect(within(queues).getByText("emails")).toBeInTheDocument();
    expect(within(queues).getByText("waiting")).toBeInTheDocument();
  });

  it("shows the not-installed states", async () => {
    mockApi([[/^api\/jobs/, view]]);
    renderPanel(JobsPanel, { session: prodViewer });

    expect(await screen.findByText(/The scheduler is not installed in this app/)).toBeInTheDocument();
    expect(screen.getByText(/The queue is not installed in this app/)).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockApi([[/^api\/jobs/, { instances: [] }]]);
    renderPanel(JobsPanel);

    expect(await screen.findByText(/No instance has reported its jobs yet/)).toBeInTheDocument();
  });

  it("shows an API error with message and ref", async () => {
    mockApi([[/^api\/jobs/, failure(500, "Jobs could not be read. Try again.", { ref: "jb-1" })]]);
    renderPanel(JobsPanel);

    expect(await screen.findByText("Jobs could not be read. Try again.")).toBeInTheDocument();
    expect(screen.getByText("jb-1")).toBeInTheDocument();
  });
});
