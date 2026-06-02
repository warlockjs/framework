import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mail tests — NEVER send real mail.
 *
 * Two strategies:
 *  1. Test mode (`setMailMode("test")`) captures into the in-memory mailbox and
 *     never touches a transport. Used for builder / mailbox / event coverage.
 *  2. Production mode with `nodemailer.createTransport` MOCKED. The mock records
 *     the exact options object passed to `transport.sendMail`, letting us assert
 *     the composed message (to / cc / subject / html / attachments) produced by
 *     `buildNodemailerOptions` — which only runs in production mode.
 *
 * Source: core/src/mail/*.
 */

const sentMessages: any[] = [];

const sendMailMock = vi.fn(async (options: any) => {
  sentMessages.push(options);
  return {
    messageId: "mock-message-id",
    accepted: Array.isArray(options.to) ? options.to : [options.to],
    rejected: [],
    response: "250 OK",
    envelope: { from: options.from, to: options.to },
  };
});

vi.mock("nodemailer", () => {
  const createTransport = vi.fn(() => ({
    sendMail: sendMailMock,
    close: vi.fn(),
    verify: vi.fn(async () => true),
  }));

  return { default: { createTransport }, createTransport };
});

import {
  Mail,
  assertMailCount,
  assertMailSent,
  clearTestMailbox,
  closeAllMailers,
  findMailsBySubject,
  findMailsTo,
  getLastMail,
  getMailboxSize,
  getTestMailbox,
  resetMailConfig,
  sendMail,
  setMailConfigurations,
  setMailMode,
  wasMailSentTo,
  wasMailSentWithSubject,
} from "../../../src/mail";

let tempDir: string;
const tempDirs: string[] = [];

beforeEach(() => {
  resetMailConfig();
  clearTestMailbox();
  sentMessages.length = 0;
  sendMailMock.mockClear();
});

afterEach(() => {
  closeAllMailers();
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sendMail — test mode capture", () => {
  beforeEach(() => setMailMode("test"));

  it("captures a mail without sending and returns success", async () => {
    const result = await sendMail({
      to: "user@example.com",
      subject: "Welcome",
      html: "<p>Hi</p>",
    });

    expect(result.success).toBe(true);
    expect(result.accepted).toEqual(["user@example.com"]);
    expect(sendMailMock).not.toHaveBeenCalled();

    const mailbox = getTestMailbox();

    expect(mailbox).toHaveLength(1);
    expect(mailbox[0].options.subject).toBe("Welcome");
  });

  it("normalizes a default from address when none is supplied", async () => {
    await sendMail({ to: "a@b.com", subject: "S", text: "T" });

    expect(getLastMail()!.normalized.from).toEqual({
      name: "No Reply",
      address: "noreply@localhost",
    });
  });

  it("captures multiple recipients", async () => {
    await sendMail({ to: ["a@b.com", "c@d.com"], subject: "Multi", text: "x" });

    const captured = getLastMail()!;

    expect(captured.normalized.to).toEqual(["a@b.com", "c@d.com"]);
  });
});

describe("test mailbox — query + assertion helpers", () => {
  beforeEach(() => setMailMode("test"));

  it("finds mails by recipient and subject", async () => {
    await sendMail({ to: "alice@x.com", subject: "Invoice #1", text: "x" });
    await sendMail({ to: "bob@x.com", subject: "Invoice #2", text: "x" });

    expect(findMailsTo("alice@x.com")).toHaveLength(1);
    expect(findMailsBySubject("Invoice")).toHaveLength(2);
    expect(wasMailSentTo("bob@x.com")).toBe(true);
    expect(wasMailSentWithSubject("Invoice #1")).toBe(true);
    expect(getMailboxSize()).toBe(2);
  });

  it("assertMailSent returns the matching mail; assertMailCount validates total", async () => {
    await sendMail({ to: "z@x.com", subject: "Hello", text: "x" });

    const mail = assertMailSent((m) => m.options.to === "z@x.com");

    expect(mail.options.subject).toBe("Hello");
    expect(() => assertMailCount(1)).not.toThrow();
    expect(() => assertMailCount(5)).toThrow(/Expected 5/);
  });

  it("assertMailSent throws when no mail matches", () => {
    expect(() => assertMailSent(() => false)).toThrow(/No mail matching/);
  });

  it("clearTestMailbox empties the mailbox", async () => {
    await sendMail({ to: "a@x.com", subject: "X", text: "x" });

    expect(getMailboxSize()).toBe(1);

    clearTestMailbox();

    expect(getMailboxSize()).toBe(0);
  });
});

describe("Mail — fluent builder", () => {
  beforeEach(() => setMailMode("test"));

  it("builds and sends via the chainable API", async () => {
    await Mail.to("user@example.com")
      .cc("manager@example.com")
      .subject("Report")
      .html("<p>Body</p>")
      .tag("reports")
      .send();

    const captured = getLastMail()!;

    expect(captured.options.to).toBe("user@example.com");
    expect(captured.options.cc).toBe("manager@example.com");
    expect(captured.options.subject).toBe("Report");
    expect(captured.options.tags).toEqual(["reports"]);
  });

  it("getOptions reflects accumulated builder state", () => {
    const builder = Mail.to("a@b.com").subject("S").text("hello").bcc("hidden@x.com");

    const options = builder.getOptions();

    expect(options.to).toBe("a@b.com");
    expect(options.subject).toBe("S");
    expect(options.bcc).toBe("hidden@x.com");
  });

  it("attach accumulates attachments", () => {
    const builder = Mail.to("a@b.com")
      .subject("S")
      .text("x")
      .attach(Buffer.from("one"), "one.txt")
      .attach(Buffer.from("two"), "two.txt", "text/plain");

    const attachments = builder.getOptions().attachments!;

    expect(attachments).toHaveLength(2);
    expect(attachments[1]).toMatchObject({ filename: "two.txt", contentType: "text/plain" });
  });

  it("validates recipient is required", async () => {
    // mailer() builds an instance with no `to`; validate() runs before any
    // config/transport resolution, so this throws on the missing recipient.
    await expect(Mail.mailer("default").subject("no-to").html("<p>x</p>").send()).rejects.toThrow(
      /recipient/,
    );
  });

  it("validates subject is required", async () => {
    await expect(Mail.to("a@b.com").html("<p>x</p>").send()).rejects.toThrow(/subject/);
  });

  it("validates content is required", async () => {
    await expect(Mail.to("a@b.com").subject("empty").send()).rejects.toThrow(/content/);
  });
});

describe("sendMail — beforeSending cancellation", () => {
  beforeEach(() => setMailMode("test"));

  it("cancels the send when beforeSending returns false", async () => {
    const result = await sendMail({
      to: "a@b.com",
      subject: "Cancel me",
      text: "x",
      beforeSending: () => false,
    });

    expect(result.success).toBe(false);
    expect(result.rejected).toEqual(["a@b.com"]);
    expect(getMailboxSize()).toBe(0);
  });
});

describe("sendMail — composed nodemailer message (production, transport mocked)", () => {
  beforeEach(() => {
    setMailMode("production");
    setMailConfigurations({
      jsonTransport: true,
      from: { name: "App", address: "noreply@app.com" },
    } as any);
  });

  it("composes to / from / subject / html for nodemailer", async () => {
    await sendMail({
      to: "user@example.com",
      subject: "Composed",
      html: "<h1>Hello</h1>",
    });

    expect(sendMailMock).toHaveBeenCalledTimes(1);

    const message = sentMessages[0];

    expect(message.to).toEqual(["user@example.com"]);
    expect(message.from).toBe('"App" <noreply@app.com>');
    expect(message.subject).toBe("Composed");
    expect(message.html).toBe("<h1>Hello</h1>");
  });

  it("includes cc, bcc, replyTo, and text when set", async () => {
    await sendMail({
      to: ["a@b.com"],
      cc: ["c@d.com"],
      bcc: ["secret@x.com"],
      replyTo: "reply@x.com",
      subject: "Full",
      text: "plain body",
    });

    const message = sentMessages[0];

    expect(message.cc).toEqual(["c@d.com"]);
    expect(message.bcc).toEqual(["secret@x.com"]);
    expect(message.replyTo).toBe("reply@x.com");
    expect(message.text).toBe("plain body");
  });

  it("passes buffer attachments through to nodemailer", async () => {
    await sendMail({
      to: "a@b.com",
      subject: "With attachment",
      text: "x",
      attachments: [{ filename: "invoice.pdf", content: Buffer.from("PDF-bytes") }],
    });

    const message = sentMessages[0];

    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].filename).toBe("invoice.pdf");
    expect(message.attachments[0].content.toString()).toBe("PDF-bytes");
  });

  it("reads file-path attachments from disk before sending", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "warlock-mail-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "terms.txt");
    writeFileSync(filePath, "terms-content");

    await sendMail({
      to: "a@b.com",
      subject: "File attachment",
      text: "x",
      attachments: [{ filename: "terms.txt", path: filePath }],
    });

    const message = sentMessages[0];

    expect(message.attachments[0].content.toString()).toBe("terms-content");
  });

  it("maps a custom header through", async () => {
    await sendMail({
      to: "a@b.com",
      subject: "Headers",
      text: "x",
      headers: { "X-Campaign": "spring-sale" },
    });

    expect(sentMessages[0].headers).toEqual({ "X-Campaign": "spring-sale" });
  });

  it("reports success with accepted recipients", async () => {
    const result = await sendMail({ to: "ok@x.com", subject: "S", text: "x" });

    expect(result.success).toBe(true);
    expect(result.accepted).toEqual(["ok@x.com"]);
    expect(result.messageId).toBe("mock-message-id");
  });
});
