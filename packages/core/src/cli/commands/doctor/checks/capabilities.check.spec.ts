import { beforeEach, describe, expect, it } from "vitest";
import {
  defineCapability,
  provideCapability,
  resetCapabilities,
} from "../../../../capabilities/capability";
import type { DoctorBootContext } from "../check.types";
import { capabilitiesCheck } from "./capabilities.check";

const booted = { booted: true } as DoctorBootContext;

beforeEach(() => {
  resetCapabilities();
});

describe("doctor capabilities check", () => {
  it("opts out when the app defines no capability", async () => {
    expect(await capabilitiesCheck.run(booted)).toBeUndefined();
  });

  it("opts out when the boot pass did not complete", async () => {
    defineCapability<string>("billing.mailer");

    expect(await capabilitiesCheck.run({ booted: false } as DoctorBootContext)).toBeUndefined();
  });

  it("warns with WL2008 for a required capability nobody provided", async () => {
    defineCapability<string>("billing.mailer");
    provideCapability(defineCapability<string>("billing.pdf"), "pdf");

    const result = await capabilitiesCheck.run(booted);

    expect(result).toMatchObject({ name: "capabilities", status: "warn", code: "WL2008" });
    expect(result?.detail).toContain("billing.mailer");
    expect(result?.detail).not.toContain("billing.pdf");
    expect(result?.detail).toContain("provideCapability()");
  });

  it("does not warn about an optional capability without a provider", async () => {
    defineCapability<string>("billing.audit", { required: false });

    expect(await capabilitiesCheck.run(booted)).toMatchObject({ status: "ok" });
  });

  it("is ok when every required capability is provided", async () => {
    provideCapability(defineCapability<string>("billing.mailer"), "mailer");

    const result = await capabilitiesCheck.run(booted);

    expect(result).toMatchObject({ status: "ok" });
    expect(result?.detail).toContain("1 capability");
  });
});
