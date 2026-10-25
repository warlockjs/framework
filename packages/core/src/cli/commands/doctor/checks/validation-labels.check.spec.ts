import { extend } from "@mongez/localization";
import { v } from "@warlock.js/seal";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setConfig } from "../../../../config/config-setter";
import { router } from "../../../../router/router";
import type { DoctorBootContext } from "../check.types";
import { validationLabelsCheck } from "./validation-labels.check";

const bootContext = { booted: true } as DoctorBootContext;

async function run() {
  return await validationLabelsCheck.run(bootContext);
}

function registerRoutes() {
  vi.spyOn(router, "list").mockReturnValue([
    {
      handler: {
        validation: {
          schema: v.object({
            max_dumbbell_kg: v.number(),
            profile: v.object({ display_name: v.string() }),
          }),
        },
      },
    },
  ] as never);
}

afterEach(() => {
  vi.restoreAllMocks();
  setConfig("validation", undefined as unknown as never);
  setConfig("app", undefined as unknown as never);
});

describe("doctor validation-labels check", () => {
  it("opts out unless validation.warnMissingLabels is true", async () => {
    registerRoutes();

    expect(await run()).toBeUndefined();
  });

  it("opts out when the app translates attributes itself", async () => {
    registerRoutes();
    setConfig("validation", { warnMissingLabels: true, translateAttribute: () => "x" } as never);

    expect(await run()).toBeUndefined();
  });

  it("opts out when no request schema is registered", async () => {
    vi.spyOn(router, "list").mockReturnValue([] as never);
    setConfig("validation", { warnMissingLabels: true } as never);

    expect(await run()).toBeUndefined();
  });

  it("warns with the unlabelled fields of each locale, nested fields included", async () => {
    registerRoutes();
    setConfig("app", { localeCodes: ["en", "fr"] } as never);
    setConfig("validation", { warnMissingLabels: true } as never);
    extend("en", { attributes: { max_dumbbell_kg: "Dumbbell", profile: "Profile" } });

    const result = await run();

    expect(result?.status).toBe("warn");
    expect(result?.code).toBe("WL4002");
    expect(result?.detail).toContain("en: display_name");
    expect(result?.detail).toContain("fr: display_name, max_dumbbell_kg, profile");
  });

  it("is ok when every field has a label in each locale", async () => {
    registerRoutes();
    setConfig("app", { localeCodes: ["en"] } as never);
    setConfig("validation", { warnMissingLabels: true } as never);
    extend("en", {
      attributes: { max_dumbbell_kg: "Dumbbell", profile: "Profile" },
      validation: { attributes: { display_name: "Name" } },
    });

    expect((await run())?.status).toBe("ok");
  });
});
