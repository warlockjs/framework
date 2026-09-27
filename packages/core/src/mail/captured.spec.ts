import { afterEach, describe, expect, it, vi } from "vitest";
import { resetMailConfig, setMailMode } from "./config";
import { mailEvents } from "./events";
import { getMailer } from "./mailer-pool";
import { sendMail } from "./send-mail";
import { clearTestMailbox, getLastMail } from "./test-mailbox";

vi.mock("./mailer-pool", () => ({
  getMailer: vi.fn(),
}));

const mockedGetMailer = vi.mocked(getMailer);

describe("mail.captured", () => {
  const subscriptions: Array<{ unsubscribe: () => void }> = [];

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.unsubscribe());
    clearTestMailbox();
    resetMailConfig();
    vi.clearAllMocks();
  });

  it("fires with the full normalized mail in development mode", async () => {
    setMailMode("development");
    const captured = vi.fn();
    subscriptions.push(mailEvents.onCaptured(captured));

    await sendMail({
      id: "development-capture",
      to: "developer@example.com",
      subject: "Development capture",
      html: "<p>Development body</p>",
      text: "Development body",
      headers: { "x-mail-source": "spec" },
    });

    expect(captured).toHaveBeenCalledOnce();
    expect(captured).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "development-capture",
        normalized: expect.objectContaining({
          to: ["developer@example.com"],
          subject: "Development capture",
          html: "<p>Development body</p>",
        }),
      }),
    );
  });

  it("fires and stores the same captured mail in test mode", async () => {
    setMailMode("test");
    const captured = vi.fn();
    subscriptions.push(mailEvents.onCaptured(captured));

    await sendMail({
      id: "test-capture",
      to: "tester@example.com",
      subject: "Test capture",
      html: "<p>Test body</p>",
    });

    expect(captured).toHaveBeenCalledOnce();
    expect(captured).toHaveBeenCalledWith(getLastMail());
    expect(getLastMail()).toMatchObject({
      id: "test-capture",
      normalized: { subject: "Test capture", html: "<p>Test body</p>" },
    });
  });

  it("does not fire in production mode", async () => {
    setMailMode("production");
    const captured = vi.fn();
    subscriptions.push(mailEvents.onCaptured(captured));
    mockedGetMailer.mockResolvedValue({
      sendMail: vi.fn().mockResolvedValue({
        accepted: ["production@example.com"],
        rejected: [],
        messageId: "production-message",
        response: "queued",
      }),
    } as any);

    await sendMail({
      to: "production@example.com",
      subject: "Production send",
      html: "<p>Production body</p>",
    });

    expect(mockedGetMailer).toHaveBeenCalledOnce();
    expect(captured).not.toHaveBeenCalled();
  });

  it("does not reject when a captured listener throws", async () => {
    setMailMode("development");
    subscriptions.push(
      mailEvents.onCaptured(() => {
        throw new Error("listener failure");
      }),
    );

    await expect(
      sendMail({ to: "safe@example.com", subject: "Safe capture", html: "<p>Safe</p>" }),
    ).resolves.toMatchObject({ success: true });
  });
});
