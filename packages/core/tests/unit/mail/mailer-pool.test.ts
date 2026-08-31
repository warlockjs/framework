import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 60s, against core's 10s default.
 *
 * This case does `vi.resetModules()` and then imports `src/mail/mailer-pool`
 * COLD, which pulls the mail graph (nodemailer plus the SES client) through the
 * transform pipeline from scratch. Standalone that is cheap: 2.57s wall, 1.67s
 * in the test itself. Inside the full suite, competing with ~190 other files for
 * CPU, the same import inflated past 10s and the case failed at 10108ms - a
 * timeout, not a wrong answer. It passes standalone every time.
 *
 * A budget sitting just above the typical number makes the verdict track machine
 * load rather than the code - the same trap `web/vitest.config.ts` documents for
 * its server specs, which failed at 30342/30003/30094ms against a 30s budget. So
 * this sits well clear of the measured cost instead of near it. The budget is
 * scoped to this file; the rest of core keeps the 10s default and still catches
 * genuinely slow tests.
 */
vi.setConfig({ testTimeout: 60_000 });

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
