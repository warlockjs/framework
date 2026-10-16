import { log } from "@warlock.js/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetMailConfig, setMailMode } from "./config";
import { getMailer } from "./mailer-pool";
import { sendMail } from "./send-mail";
import { clearTestMailbox } from "./test-mailbox";

vi.mock("./mailer-pool", () => ({
  getMailer: vi.fn(),
}));

const mockedGetMailer = vi.mocked(getMailer);

/**
 * recipient addresses are personal data and sit inside the log
 * message, where key-based redaction cannot reach them, so every mail log
 * line carries them masked.
 */
function loggedText(): string {
  return [
    ...vi.mocked(log.info).mock.calls,
    ...vi.mocked(log.warn).mock.calls,
    ...vi.mocked(log.error).mock.calls,
    ...vi.mocked(log.success).mock.calls,
  ]
    .map((call) => call.map(String).join(" "))
    .join("\n");
}

describe("sendMail log privacy", () => {
  afterEach(() => {
    clearTestMailbox();
    resetMailConfig();
    vi.restoreAllMocks();
  });

  function spyOnLog() {
    vi.spyOn(log, "info").mockImplementation(() => log);
    vi.spyOn(log, "warn").mockImplementation(() => log);
    vi.spyOn(log, "error").mockImplementation(() => log);
    vi.spyOn(log, "success").mockImplementation(() => log);
  }

  it("masks the recipients when a mail is sent", async () => {
    setMailMode("production");
    spyOnLog();
    mockedGetMailer.mockResolvedValue({
      sendMail: vi.fn(async () => ({
        messageId: "<id@example.com>",
        accepted: ["member@example.com", "other@example.org"],
        rejected: [],
      })),
    } as never);

    await sendMail({
      to: ["member@example.com", "other@example.org"],
      subject: "Hello",
      text: "Hi",
    });

    const text = loggedText();

    expect(text).toContain("2 recipient(s)");
    expect(text).toContain("m***@example.com");
    expect(text).not.toContain("member@example.com");
    expect(text).not.toContain("other@example.org");
  });

  it("masks partially rejected recipients", async () => {
    setMailMode("production");
    spyOnLog();
    mockedGetMailer.mockResolvedValue({
      sendMail: vi.fn(async () => ({
        messageId: "<id@example.com>",
        accepted: ["member@example.com"],
        rejected: ["bounced@example.net"],
      })),
    } as never);

    await sendMail({
      to: ["member@example.com", "bounced@example.net"],
      subject: "Hello",
      text: "Hi",
    });

    const text = loggedText();

    expect(text).toContain("b***@example.net");
    expect(text).not.toContain("bounced@example.net");
  });

  it("masks addresses inside a provider error that is logged", async () => {
    setMailMode("production");
    spyOnLog();
    mockedGetMailer.mockResolvedValue({
      sendMail: vi.fn(async () => {
        throw new Error("550 Recipient address rejected: member@example.com");
      }),
    } as never);

    await sendMail({ to: "member@example.com", subject: "Hello", text: "Hi" }).catch(
      () => undefined,
    );

    const text = loggedText();

    expect(text).not.toContain("member@example.com");
  });

  it("masks the recipients in development mode", async () => {
    setMailMode("development");
    spyOnLog();

    await sendMail({ to: "developer@example.com", subject: "Dev", text: "Dev" });

    const text = loggedText();

    expect(text).toContain("d***@example.com");
    expect(text).not.toContain("developer@example.com");
  });
});
