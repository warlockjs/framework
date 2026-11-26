import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseGrimoire } from "../../src/written";

const TEMPLATE = fileURLToPath(
  new URL("../../../create-warlock/templates/warlock", import.meta.url),
);

describe("the starter app's grimoire/ folder", () => {
  it("parses with no structure errors and carries the accounts, contact and design-system features", async () => {
    const { written, findings } = await parseGrimoire(TEMPLATE);

    expect(path.basename(TEMPLATE)).toBe("warlock");
    expect(
      findings.filter((finding) => finding.severity === "error" && finding.code.startsWith("GR1")),
    ).toEqual([]);
    expect(written.features.map((feature) => feature.id)).toEqual([
      "accounts",
      "contact",
      "design-system",
    ]);

    const criteria = Object.fromEntries(
      written.features.flatMap((feature) =>
        feature.flows.map((flow) => [
          flow.ref,
          flow.criteria.map((item) => `${item.id} ${item.text}`),
        ]),
      ),
    );

    expect(criteria["design-system/direction"]).toEqual([
      "AC-1 Inputs, labels and text align to the start of the reading direction (right in Arabic).",
      "AC-2 In Arabic the page is mirrored: the layout runs right to left.",
    ]);
    expect(criteria["design-system/components"]).toEqual([
      "AC-1 Every form control renders in each language.",
    ]);
    expect(criteria["design-system/error-messages"]).toEqual([
      "AC-1 Every error says what failed and what to do next.",
    ]);
    expect(criteria["contact/send-message"]).toHaveLength(4);
    expect(
      Object.keys(criteria)
        .filter((ref) => ref.startsWith("accounts/"))
        .sort(),
    ).toEqual([
      "accounts/posts",
      "accounts/reset-password",
      "accounts/sign-in",
      "accounts/uploads",
      "accounts/users",
    ]);
  });

  it("names the design system in the contact feature's relations", async () => {
    const { written } = await parseGrimoire(TEMPLATE);
    const contact = written.features.find((feature) => feature.id === "contact");

    expect(contact?.readme?.relations.flatMap((item) => item.refs)).toEqual([
      "design-system/direction",
      "design-system/components",
      "design-system/error-messages",
    ]);
  });
});
