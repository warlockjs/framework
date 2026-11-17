import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { MailPanel } from "@/panels/mail";
import { failure, FakeEventSource, mockApi, renderPanel } from "./helpers";

const summary = {
  id: "m1",
  requestId: "req-3",
  capturedAt: Date.now() - 5000,
  to: ["a@x.test"],
  subject: "Welcome <b>aboard</b>",
};
const mail = {
  ...summary,
  from: "noreply@x.test",
  cc: [],
  bcc: [],
  text: "plain body",
  headers: { "x-tag": "welcome" },
  attachments: [{ filename: "terms.pdf", contentType: "application/pdf", size: 2048 }],
};

beforeEach(() => FakeEventSource.install());

describe("Mail panel", () => {
  it("lists messages and shows a detail with a sandboxed HTML frame", async () => {
    mockApi([
      ["api/mails", [summary]],
      ["api/mails/m1", mail],
    ]);
    const user = userEvent.setup();

    renderPanel(MailPanel);
    await user.click(await screen.findByText("Welcome <b>aboard</b>"));

    const frame = await screen.findByTitle("HTML email body");

    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame).toHaveAttribute("src", "api/mails/m1/html");
    expect(screen.getByText("terms.pdf · application/pdf · 2,048 bytes")).toBeInTheDocument();
    expect(screen.getByText("x-tag")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the request that sent it" })).toHaveAttribute(
      "href",
      "#requests/req-3",
    );
    expect(document.querySelector("b")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Text" }));
    expect(screen.getByText("plain body")).toBeInTheDocument();
    expect(screen.queryByTitle("HTML email body")).not.toBeInTheDocument();
  });

  it("adds a live message from the stream", async () => {
    mockApi([["api/mails", [summary]]]);
    renderPanel(MailPanel);
    await screen.findByText("Welcome <b>aboard</b>");

    act(() => FakeEventSource.latest().emit("mail", { ...summary, id: "m2", subject: "Receipt" }));

    expect(await screen.findByText("Receipt")).toBeInTheDocument();
  });

  it("shows the empty state", async () => {
    mockApi([["api/mails", []]]);
    renderPanel(MailPanel);

    expect(await screen.findByText(/No mail captured/)).toBeInTheDocument();
    expect(screen.getByText("Select a message to inspect it.")).toBeInTheDocument();
  });

  it("shows API errors with message and ref", async () => {
    mockApi([
      ["api/mails", failure(500, "The mailbox could not be read. Try again.", { ref: "ml-1" })],
    ]);
    renderPanel(MailPanel);

    expect(
      await screen.findByText("The mailbox could not be read. Try again."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reference: ml-1")).toBeInTheDocument();
  });

  it("shows a missing message as an error", async () => {
    mockApi([
      ["api/mails", [summary]],
      ["api/mails/m1", failure(404, "That message is no longer in the mailbox. Pick another one.")],
    ]);
    renderPanel(MailPanel, { route: "m1" });

    expect(
      await screen.findByText("That message is no longer in the mailbox. Pick another one."),
    ).toBeInTheDocument();
  });
});
