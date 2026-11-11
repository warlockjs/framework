import { createHmac } from "node:crypto";
import { BadRequestError, config, t } from "@warlock.js/core";
import { OTP } from "../models/otp";
import { AuthErrorCode } from "../utils/auth-error-code";
import { generateOtpCode, hashOtpCode, otpCodeMatches } from "../utils/otp-code";
import type { OTPChannel, OTPType } from "../utils/types";

/** Human-friendly duration parts, summed to milliseconds by `parseDurationToMs`. */
type Duration = {
  milliseconds?: number;
  seconds?: number;
  minutes?: number;
  hours?: number;
  days?: number;
  weeks?: number;
};

// Default OTP expiration
const DEFAULT_OTP_EXPIRATION: Duration = { minutes: 15 };

// Parse duration to milliseconds
function parseDurationToMs(duration: Duration): number {
  let ms = 0;
  if (duration.milliseconds) {
    ms += duration.milliseconds;
  }
  if (duration.seconds) {
    ms += duration.seconds * 1000;
  }
  if (duration.minutes) {
    ms += duration.minutes * 60 * 1000;
  }
  if (duration.hours) {
    ms += duration.hours * 60 * 60 * 1000;
  }
  if (duration.days) {
    ms += duration.days * 24 * 60 * 60 * 1000;
  }
  if (duration.weeks) {
    ms += duration.weeks * 7 * 24 * 60 * 60 * 1000;
  }
  return ms;
}

export type CreateOTPOptions = {
  target: string;
  channel: OTPChannel;
  type: OTPType;
  userId?: number | string;
  userType?: string;
  expiresIn?: Duration;
  length?: number;
  alphanumeric?: boolean;
  maxAttempts?: number;
  metadata?: object;
};

export type CreatedOTP = {
  otp: OTP;
  /** The plain code, to deliver to the user. Only its hash is stored. */
  code: string;
};

/**
 * The key OTP codes are hashed with, derived from the access-token secret
 * (`JWT_SECRET`). Call it before looking anything up, so a missing secret
 * fails the same way for every request.
 */
export function otpHashKey(): string {
  const secret = config.key<string | undefined>("auth.accessToken.secret");

  if (!secret) {
    throw new Error(
      "Verification codes are hashed with auth.accessToken.secret, which is not set. " +
        "Run `npm run jwt` to generate JWT_SECRET in .env.",
    );
  }

  return createHmac("sha256", secret).update("app:otp-code").digest("hex");
}

/** The one answer for every rejected code: unknown, wrong, expired, used or out of attempts. */
function invalidCodeError(): BadRequestError {
  return new BadRequestError(t("auth.otpInvalid"), {
    errorCode: AuthErrorCode.OTP_INVALID,
  });
}

/**
 * Create a new OTP and return it with its plain code. Earlier unused OTPs for
 * the same target and type stop working.
 */
export async function createOtpService(options: CreateOTPOptions): Promise<CreatedOTP> {
  const {
    target,
    channel,
    type,
    userId,
    userType,
    expiresIn = DEFAULT_OTP_EXPIRATION,
    length = 6,
    alphanumeric = false,
    maxAttempts = 5,
    metadata,
  } = options;

  const key = otpHashKey();

  // Invalidate any existing unused OTPs for this target+type
  await cleanupOtpService(target, type);

  const code = generateOtpCode(length, alphanumeric);
  const expiresAt = new Date(Date.now() + parseDurationToMs(expiresIn));

  const otp = await OTP.create({
    codeHash: hashOtpCode(key, target, type, code),
    type,
    target,
    channel,
    userId,
    userType,
    expiresAt,
    maxAttempts,
    metadata,
  });

  return { otp, code };
}

/**
 * Verify an OTP and mark it as used.
 *
 * Every check counts one attempt first; after `maxAttempts` wrong codes the
 * OTP stops working, even under concurrent guesses. Every rejection answers
 * with the same error, so a caller cannot tell whether a code was ever issued
 * for `target`.
 */
export async function verifyOtpService(
  code: string,
  target: string,
  type: OTPType,
): Promise<OTP | never> {
  const key = otpHashKey();

  const otp = await OTP.first({
    target,
    type,
    usedAt: null,
  });

  if (!otp || otp.isExpired) {
    throw invalidCodeError();
  }

  if (!(await otp.recordAttempt())) {
    // Out of attempts: retire the code so it can never be redeemed.
    await otp.consume();

    throw invalidCodeError();
  }

  if (!otpCodeMatches(key, otp.get("codeHash"), target, type, code)) {
    throw invalidCodeError();
  }

  if (!(await otp.consume())) {
    throw invalidCodeError();
  }

  return otp;
}

export async function cleanupOtpService(target: string, type: OTPType): Promise<void> {
  await OTP.delete({
    target,
    type,
    usedAt: null,
  });
}

/**
 * Resend OTP (invalidate old and create new)
 */
export async function resendOtpService(
  target: string,
  type: OTPType,
  channel: OTPChannel,
  options?: Partial<CreateOTPOptions>,
): Promise<CreatedOTP> {
  await cleanupOtpService(target, type);
  return createOtpService({
    target,
    type,
    channel,
    ...options,
  });
}

/**
 * Cleanup expired OTPs
 */
export async function cleanupExpiredOtpsService(): Promise<number> {
  const expiredOtps = await OTP.query().where("expiresAt", "<", new Date()).get();

  await Promise.all(expiredOtps.map((otp) => otp.destroy()));

  return expiredOtps.length;
}
