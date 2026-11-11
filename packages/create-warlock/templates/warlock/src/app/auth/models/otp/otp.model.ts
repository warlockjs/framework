import { Model, RegisterModel } from "@warlock.js/cascade";
import { v, type Infer } from "@warlock.js/seal";

const otpSchema = v.object({
  // Keyed hash of the code (see `app/auth/utils/otp-code.ts`); the code itself is never stored.
  codeHash: v.string(),
  type: v.string(),
  target: v.string(),
  channel: v.string(),
  userId: v.number(),
  userType: v.string(),
  expiresAt: v.date(),
  usedAt: v.date().optional(),
  attempts: v.number().default(0),
  maxAttempts: v.number().default(5),
  metadata: v.record(v.any()).optional(),
});

type OTPSchema = Infer<typeof otpSchema>;

@RegisterModel()
export class OTP extends Model<OTPSchema> {
  /**
   * Table name
   */
  public static table = "otps";

  /**
   * Model schema
   */
  public static schema = otpSchema;

  /**
   * Never serialize the code hash: for a short code it is as sensitive as the code.
   */
  public static hidden = ["codeHash"];

  /**
   * Check if OTP is valid (not expired, not used, not max attempts)
   */
  public get isValid(): boolean {
    if (this.get("usedAt")) {
      return false;
    }
    if ((this.get("attempts") ?? 0) >= (this.get("maxAttempts") ?? 0)) {
      return false;
    }
    if (new Date() > new Date(this.get("expiresAt"))) {
      return false;
    }
    return true;
  }

  /**
   * Check if OTP is expired
   */
  public get isExpired(): boolean {
    return new Date() > new Date(this.get("expiresAt"));
  }

  /**
   * Check if max attempts exceeded
   */
  public get isMaxAttemptsExceeded(): boolean {
    return (this.get("attempts") ?? 0) >= (this.get("maxAttempts") ?? 0);
  }

  /**
   * Count one verification attempt, atomically and only while the OTP is
   * unused and under `maxAttempts`. Resolves `false` when no attempt is left,
   * so concurrent guesses can never compare the code more than `maxAttempts`
   * times in total.
   */
  public async recordAttempt(): Promise<boolean> {
    const counted = await OTP.atomic(
      { id: this.id, usedAt: null, attempts: { $lt: this.get("maxAttempts") ?? 0 } },
      { $inc: { attempts: 1 } },
      // Code-authored filter; nothing here comes from the request.
      { trustedFilter: true },
    );

    return counted > 0;
  }

  /**
   * Mark the OTP as used. Resolves `false` when another request used it first,
   * so a code is redeemed at most once.
   */
  public async consume(): Promise<boolean> {
    const consumed = await OTP.atomic(
      { id: this.id, usedAt: null },
      { $set: { usedAt: new Date() } },
    );

    return consumed > 0;
  }
}
