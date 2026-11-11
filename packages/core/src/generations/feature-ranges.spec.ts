import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imageFeature } from "./features/image.feature";
import { mailFeature } from "./features/mail.feature";

/**
 * `warlock add mail` / `warlock add image` must install releases that carry
 * the fixes for the libraries' published advisories, and core's optional peer
 * ranges must accept them.
 */
const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"),
) as { peerDependencies: Record<string, string> };

describe("feature dependency ranges", () => {
  it("installs nodemailer 10.1.4 or later", () => {
    expect(mailFeature.dependencies?.nodemailer).toBe("^10.1.4");
    expect(packageJson.peerDependencies.nodemailer).toContain("^10.1.4");
  });

  it("installs sharp 0.35.5 or later", () => {
    expect(imageFeature.dependencies?.sharp).toBe("^0.35.5");
    expect(packageJson.peerDependencies.sharp).toContain("^0.35.5");
  });
});
