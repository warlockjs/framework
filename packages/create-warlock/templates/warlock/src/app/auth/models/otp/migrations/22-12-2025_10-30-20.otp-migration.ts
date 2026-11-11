import { integer, json, Migration, string, timestamp } from "@warlock.js/cascade";
import { OTP } from "../otp.model";

export default Migration.create(
  OTP,
  {
    codeHash: string(64),
    type: string(50),
    target: string(255),
    channel: string(50),
    userId: integer().index(),
    userType: string(50),
    expiresAt: timestamp().index(),
    usedAt: timestamp().nullable(),
    attempts: integer(),
    maxAttempts: integer(),
    metadata: json().nullable(),
  },
  {
    index: [
      {
        columns: ["target", "type"],
      },
    ],
  },
);
