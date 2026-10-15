import { describe, expect, it } from "vitest";

import { resolveContactScaffold } from "../../../src/generations/features/shared/resolve-contact-scaffold";

/**
 * `warlock add web` wrote `src/app/contact/controllers/contact.controller.ts`
 * and `src/app/contact/routes.ts` unconditionally, guarded by nothing — unlike
 * `src/web/root.tsx`, which the same function refuses to touch once it exists.
 * A project that already had its own `contact` module lost it, silently, to
 * an `add` command. `resolveContactScaffold` is the pure decision the fix
 * hangs off: given which of the two files already exist, it says which are
 * safe to write and what to tell the user about the ones that are not.
 */
describe("resolveContactScaffold", () => {
  it("canon 77c18a77 — with no existing contact files, both are written", () => {
    const plan = resolveContactScaffold({ controllerExists: false, routesExists: false });

    expect(plan.writeController).toBe(true);
    expect(plan.writeRoutes).toBe(true);
  });

  it("does not write an existing contact.controller.ts, and names it in the report", () => {
    const plan = resolveContactScaffold({ controllerExists: true, routesExists: false });

    expect(plan.writeController).toBe(false);
    expect(plan.writeRoutes).toBe(true);
    expect(plan.messages.join("\n")).toContain(
      "src/app/contact/controllers/contact.controller.ts",
    );
  });

  it("does not write an existing routes.ts, and names it in the report", () => {
    const plan = resolveContactScaffold({ controllerExists: false, routesExists: true });

    expect(plan.writeController).toBe(true);
    expect(plan.writeRoutes).toBe(false);
    expect(plan.messages.join("\n")).toContain("src/app/contact/routes.ts");
  });

  it("with both existing, writes neither and still produces a report instead of throwing", () => {
    const plan = resolveContactScaffold({ controllerExists: true, routesExists: true });

    expect(plan.writeController).toBe(false);
    expect(plan.writeRoutes).toBe(false);
    expect(plan.messages).toHaveLength(2);
  });

  it("the report explicitly states the consequence — the contact form's endpoint is missing — not merely that a file was skipped", () => {
    const controllerSkipped = resolveContactScaffold({
      controllerExists: true,
      routesExists: false,
    });
    const routesSkipped = resolveContactScaffold({ controllerExists: false, routesExists: true });

    expect(controllerSkipped.messages.join("\n")).toMatch(/contact form's endpoint/);
    expect(controllerSkipped.messages.join("\n")).toMatch(/404/);
    expect(routesSkipped.messages.join("\n")).toMatch(/contact form's endpoint/);
    expect(routesSkipped.messages.join("\n")).toMatch(/404/);
  });

  it("reports success, not a skip, once both files are freshly written", () => {
    const plan = resolveContactScaffold({ controllerExists: false, routesExists: false });

    expect(plan.messages).toHaveLength(1);
    expect(plan.messages[0]).toContain("Created POST /api/contact starter route");
  });
});
