import { describe, expect, it } from "vitest";
import { lowerStage3Decorators } from "../../../src/vite/lower-stage3-decorators";

describe("lowerStage3Decorators", () => {
  const plugin = lowerStage3Decorators();

  it("exposes a pre-enforced vite plugin", () => {
    expect(plugin.name).toBe("warlock:lower-stage3-decorators");
    expect(plugin.enforce).toBe("pre");
  });

  it("lowers a native decorator so no leading `@` survives", async () => {
    const source = ["@RegisterModel('users')", "export class User {}"].join("\n");

    const result = await plugin.transform(source, "/app/user.model.ts");

    expect(result).not.toBeNull();
    // The decorator is lowered to a helper call — the raw `@RegisterModel` is gone.
    expect(result!.code).not.toMatch(/^\s*@RegisterModel/m);
    expect(result!.code).toContain("RegisterModel");
    expect(typeof result!.map).toBe("string");
  });

  it("lowers decorators in .tsx files too", async () => {
    const source = ["@Component()", "export class Widget {}"].join("\n");

    const result = await plugin.transform(source, "/app/widget.tsx");

    expect(result).not.toBeNull();
    expect(result!.code).not.toMatch(/^\s*@Component/m);
  });

  it("skips files without a decorator (fast path)", async () => {
    const result = await plugin.transform("export const value = 1;", "/app/plain.ts");

    expect(result).toBeNull();
  });

  it("skips node_modules", async () => {
    const source = ["@Injectable()", "class A {}"].join("\n");

    const result = await plugin.transform(source, "/x/node_modules/pkg/index.ts");

    expect(result).toBeNull();
  });

  it("skips non-TypeScript files", async () => {
    const source = ["@decorator", "class A {}"].join("\n");

    const result = await plugin.transform(source, "/app/styles.css");

    expect(result).toBeNull();
  });
});
