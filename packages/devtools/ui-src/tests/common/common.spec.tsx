import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import {
  Bytes,
  ConfirmDialog,
  CopyButton,
  Duration,
  EmptyState,
  ErrorMessage,
  RelativeTime,
  formatBytes,
  formatDuration,
  formatRelativeTime,
} from "@/components/common";

describe("common components", () => {
  it("formats durations, sizes and relative times", () => {
    expect(formatDuration(12)).toBe("12 ms");
    expect(formatDuration(1400)).toBe("1.4 s");
    expect(formatDuration(0.25)).toBe("0.25 ms");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(21_286_912)).toBe("20.3 MB");
    expect(formatRelativeTime(1000, 1000 + 300_000)).toBe("5 min ago");
    expect(formatRelativeTime(1000, 1000)).toBe("just now");
    expect(formatRelativeTime(10_000_000, 1000)).toBe("in 3 h");
  });

  it("renders them and a fallback for absent values", () => {
    render(
      <>
        <Duration ms={1400} />
        <Duration ms={null} />
        <Bytes bytes={2048} />
        <RelativeTime at={null} fallback="never signed in" />
      </>,
    );

    expect(screen.getByText("1.4 s")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(screen.getByText("never signed in")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("ErrorMessage shows the message and the reference of an ApiError", () => {
    render(
      <ErrorMessage error={new ApiError("Could not save. Try again.", 500, { ref: "XY123456" })} />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save. Try again.");
    expect(screen.getByText("Reference: XY123456")).toBeInTheDocument();
  });

  it("ErrorMessage renders nothing without an error and never a bare generic message", () => {
    const { container, rerender } = render(<ErrorMessage error={null} />);

    expect(container).toBeEmptyDOMElement();
    rerender(<ErrorMessage error={{}} />);
    expect(screen.getByRole("alert")).not.toHaveTextContent(/^Something went wrong$/);
    expect(screen.getByRole("alert")).toHaveTextContent(/Try again/);
  });

  it("EmptyState shows its hint", () => {
    render(<EmptyState title="No requests yet." hint="Send one to the app." />);
    expect(screen.getByText("Send one to the app.")).toBeInTheDocument();
  });

  it("CopyButton copies and says so; says what to do when the browser blocks it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { unmount } = render(<CopyButton value="hello" />);

    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("hello");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    unmount();

    writeText.mockRejectedValue(new Error("denied"));
    render(<CopyButton value="hello" />);
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/blocked copying/)).toBeInTheDocument();
  });

  it("ConfirmDialog stays open and shows the error when the action fails", async () => {
    const onOpenChange = vi.fn();

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete it?"
        description="Gone for good."
        confirmLabel="Delete"
        onConfirm={async () => {
          throw new ApiError("Could not delete. Try again.", 500, { ref: "DEL00001" });
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Could not delete. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Reference: DEL00001")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
