import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getMailer (ses driver) nodemailer load guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("nodemailer");
    vi.doUnmock("@aws-sdk/client-sesv2");
  });

  it("awaits nodemailerLoadPromise before reading nodemailerModule instead of reading it unsettled", async () => {
    let releaseNodemailer: () => void = () => {};
    const nodemailerReady = new Promise<void>((resolve) => {
      releaseNodemailer = resolve;
    });

    const createTransport = vi.fn((options: unknown) => ({ options }));

    vi.doMock("nodemailer", async () => {
      await nodemailerReady;
      return { default: { createTransport } };
    });

    vi.doMock("@aws-sdk/client-sesv2", async () => {
      return {
        default: {
          SESv2Client: class {
            constructor(_options: unknown) {}
          },
          SendEmailCommand: class {},
        },
      };
    });

    const { getMailer } = await import("../../../src/mail/mailer-pool");

    // Called immediately after import: nodemailerLoadPromise has been kicked off
    // but not yet awaited/settled anywhere. If the internal SES mailer read
    // `nodemailerModule` without guarding on the promise, this would throw
    // "Cannot read properties of undefined (reading 'createTransport')".
    const pending = getMailer({
      driver: "ses",
      region: "us-east-1",
      accessKeyId: "key",
      secretAccessKey: "secret",
    } as any);

    releaseNodemailer();

    const transporter = await pending;

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(transporter).toEqual({
      options: expect.objectContaining({
        SES: expect.objectContaining({ sesClient: expect.anything() }),
      }),
    });
  });
});
