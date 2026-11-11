import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The starter's password-reset flow (`templates/warlock/src/app/auth`), run
 * against in-memory fakes of the framework and the OTP model, so it needs no
 * database: codes come from a secure generator and are stored only as a keyed
 * hash, every check counts an attempt and the code dies after `maxAttempts`,
 * every rejection looks the same, and `forgot-password` answers known and
 * unknown emails alike.
 */

type Row = {
  id: number;
  codeHash: string;
  type: string;
  target: string;
  channel: string;
  userId?: number | string;
  userType?: string;
  expiresAt: Date;
  usedAt?: Date | null;
  attempts: number;
  maxAttempts: number;
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  secret: "test-access-secret" as string | undefined,
  users: [] as { id: number; userType: string; email: string }[],
  /** When set, `User.first` waits for this promise before answering. */
  lookupGate: undefined as Promise<void> | undefined,
  logged: [] as unknown[][],
}));

vi.mock("@warlock.js/logger", () => ({
  log: {
    error: (...args: unknown[]) => {
      state.logged.push(args);
    },
  },
}));

vi.mock("@warlock.js/core", () => {
  class BadRequestError extends Error {
    public status = 400;
    public constructor(
      message: string,
      public payload?: { errorCode?: string },
    ) {
      super(message);
    }
  }

  return {
    BadRequestError,
    config: {
      key: (key: string) => (key === "auth.accessToken.secret" ? state.secret : undefined),
    },
    t: (key: string) => key,
  };
});

vi.mock("../templates/warlock/src/app/auth/models/otp", () => {
  class OTP {
    public constructor(public row: Row) {}

    public get id() {
      return this.row.id;
    }

    public get<K extends keyof Row>(key: K): Row[K] {
      return this.row[key];
    }

    public get isExpired(): boolean {
      return new Date() > this.row.expiresAt;
    }

    /** Same contract as the template model's atomic conditional update. */
    public async recordAttempt(): Promise<boolean> {
      if (this.row.usedAt || this.row.attempts >= this.row.maxAttempts) return false;
      this.row.attempts++;
      return true;
    }

    public async consume(): Promise<boolean> {
      if (this.row.usedAt) return false;
      this.row.usedAt = new Date();
      return true;
    }

    public static async create(data: Omit<Row, "id" | "attempts">): Promise<OTP> {
      const row: Row = { ...data, id: state.rows.length + 1, attempts: 0, usedAt: null };
      state.rows.push(row);
      return new OTP(row);
    }

    public static async first(filter: { target: string; type: string }): Promise<OTP | null> {
      const row = state.rows.find(
        (candidate) =>
          candidate.target === filter.target && candidate.type === filter.type && !candidate.usedAt,
      );
      return row ? new OTP(row) : null;
    }

    public static async delete(filter: { target: string; type: string }): Promise<void> {
      state.rows = state.rows.filter(
        (row) => !(row.target === filter.target && row.type === filter.type && !row.usedAt),
      );
    }
  }

  return { OTP };
});

vi.mock("app/users/models/user", () => ({
  User: {
    first: async (filter: { email: string }) => {
      await state.lookupGate;
      return state.users.find((user) => user.email === filter.email) ?? null;
    },
  },
}));

import {
  createOtpService,
  otpHashKey,
  verifyOtpService,
} from "../templates/warlock/src/app/auth/services/otp.service";
import {
  forgotPasswordService,
  issuePasswordResetCode,
} from "../templates/warlock/src/app/auth/services/forgot-password.service";
import { generateOtpCode, hashOtpCode } from "../templates/warlock/src/app/auth/utils/otp-code";

const TARGET = "sara@example.com";
const TYPE = "password-reset";

async function rejection(promise: Promise<unknown>): Promise<{ message: string; code?: string }> {
  const error = (await promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (thrown: unknown) => thrown,
  )) as Error & { status?: number; payload?: { errorCode?: string } };

  expect(error.status).toBe(400);

  return { message: error.message, code: error.payload?.errorCode };
}

beforeEach(() => {
  state.rows = [];
  state.secret = "test-access-secret";
  state.users = [{ id: 7, userType: "user", email: TARGET }];
  state.lookupGate = undefined;
  state.logged = [];
});

describe("one-time codes", () => {
  it("draws digits from the secure generator, leading zeros included", () => {
    const codes = Array.from({ length: 200 }, () => generateOtpCode());

    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
    expect(new Set(codes).size).toBeGreaterThan(190);
    expect(generateOtpCode(8, true)).toMatch(/^[A-Z0-9]{8}$/);
  });

  it("stores only a keyed hash of the code", async () => {
    const { code } = await createOtpService({ target: TARGET, channel: "email", type: TYPE });

    const [row] = state.rows;
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {})).not.toContain("code");
    expect(row?.codeHash).not.toContain(code);
    expect(row?.codeHash).toBe(hashOtpCode(otpHashKey(), TARGET, TYPE, code));
    // The key is derived from the secret, never the secret itself.
    expect(otpHashKey()).not.toBe(state.secret);
  });

  it("accepts the right code once", async () => {
    const { code } = await createOtpService({ target: TARGET, channel: "email", type: TYPE });

    await expect(verifyOtpService(code, TARGET, TYPE)).resolves.toBeDefined();
    await rejection(verifyOtpService(code, TARGET, TYPE));
  });

  it("retires the code after maxAttempts wrong tries, even for the right code", async () => {
    const { code } = await createOtpService({ target: TARGET, channel: "email", type: TYPE });
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt++) {
      await rejection(verifyOtpService(wrong, TARGET, TYPE));
    }

    await rejection(verifyOtpService(code, TARGET, TYPE));
    expect(state.rows[0]?.attempts).toBe(5);
    expect(state.rows[0]?.usedAt).toBeInstanceOf(Date);
  });

  it("answers every rejection with the same error", async () => {
    const unknownTarget = await rejection(verifyOtpService("123456", "nobody@example.com", TYPE));

    const { code } = await createOtpService({ target: TARGET, channel: "email", type: TYPE });
    const wrongCode = await rejection(
      verifyOtpService(code === "000000" ? "111111" : "000000", TARGET, TYPE),
    );

    const row = state.rows[0];
    if (row) row.expiresAt = new Date(Date.now() - 1000);
    const expired = await rejection(verifyOtpService(code, TARGET, TYPE));

    expect(wrongCode).toEqual(unknownTarget);
    expect(expired).toEqual(unknownTarget);
  });
});

describe("forgotPasswordService", () => {
  it("creates a code for a registered email and nothing for an unknown one", async () => {
    await expect(issuePasswordResetCode(TARGET)).resolves.toBeUndefined();
    await expect(issuePasswordResetCode("nobody@example.com")).resolves.toBeUndefined();

    expect(state.rows.map((row) => row.target)).toEqual([TARGET]);
    expect(state.rows[0]?.userId).toBe(7);
  });

  it("answers without waiting for the account lookup, for known and unknown emails", async () => {
    let releaseLookup!: () => void;
    state.lookupGate = new Promise<void>((resolve) => {
      releaseLookup = resolve;
    });

    // The lookup is still pending: both calls resolve anyway, with no code created yet.
    await expect(forgotPasswordService(TARGET)).resolves.toBeUndefined();
    await expect(forgotPasswordService("nobody@example.com")).resolves.toBeUndefined();
    expect(state.rows).toEqual([]);

    releaseLookup();
    await vi.waitFor(() => expect(state.rows.map((row) => row.target)).toEqual([TARGET]));
  });

  it("logs a failure of the background work instead of sending it to the caller", async () => {
    state.lookupGate = Promise.reject(new Error("database is down"));
    state.lookupGate.catch(() => undefined);

    await expect(forgotPasswordService(TARGET)).resolves.toBeUndefined();
    await vi.waitFor(() => expect(state.logged).toHaveLength(1));
    expect(state.logged[0]?.slice(0, 2)).toEqual(["auth", "forgot-password"]);
  });

  it("fails the same way for every email when the hashing secret is missing", async () => {
    state.secret = undefined;

    await expect(forgotPasswordService(TARGET)).rejects.toThrow(/auth\.accessToken\.secret/);
    await expect(forgotPasswordService("nobody@example.com")).rejects.toThrow(
      /auth\.accessToken\.secret/,
    );
  });
});
