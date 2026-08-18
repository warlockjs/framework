import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { File, fs } from "../src/index";
import { withTempDir } from "./helpers";

/**
 * `mergeJson` is the one facade that takes a caller-supplied object and merges
 * it into parsed JSON key by key — the shape a "PATCH this config file"
 * endpoint reaches for, and therefore the one place an attacker-influenced key
 * can reach a bracket assignment.
 *
 * `JSON.parse` is used for every hostile payload on purpose: an object literal
 * `{ __proto__: ... }` invokes the setter at parse time and proves nothing,
 * while parsed JSON carries a real own property named `__proto__` — exactly
 * what arrives from a request body or from a file another process wrote.
 */
describe("mergeJson — prototype pollution", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const at = (...p: string[]) => path.join(dir, ...p);

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });

  afterEach(async () => {
    delete (Object.prototype as any).isAdmin;
    delete (Object.prototype as any).polluted;
    await cleanup();
  });

  it("does not pollute Object.prototype through a deep merge", async () => {
    await fs.files.putJson(at("c.json"), { a: 1 });

    await fs.files.mergeJson(at("c.json"), JSON.parse('{"__proto__":{"isAdmin":true}}'), {
      deep: true,
    });

    expect(({} as any).isAdmin).toBeUndefined();
  });

  it("does not pollute Object.prototype through a shallow merge", async () => {
    await fs.files.putJson(at("c.json"), { a: 1 });

    await fs.files.mergeJson(at("c.json"), JSON.parse('{"__proto__":{"isAdmin":true}}'));

    expect(({} as any).isAdmin).toBeUndefined();
  });

  it("never writes a __proto__ key to disk, deep or shallow", async () => {
    await fs.files.putJson(at("deep.json"), { a: 1 });
    await fs.files.mergeJson(at("deep.json"), JSON.parse('{"__proto__":{"isAdmin":true},"a":2}'), {
      deep: true,
    });

    await fs.files.putJson(at("shallow.json"), { a: 1 });
    await fs.files.mergeJson(at("shallow.json"), JSON.parse('{"__proto__":{"isAdmin":true},"a":2}'));

    for (const file of ["deep.json", "shallow.json"]) {
      expect(await fs.files.get(at(file))).not.toContain("__proto__");
      expect(await fs.files.getJson(at(file))).toEqual({ a: 2 });
    }
  });

  it("drops constructor and prototype keys too", async () => {
    await fs.files.putJson(at("c.json"), { a: 1 });

    await fs.files.mergeJson(
      at("c.json"),
      JSON.parse('{"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"polluted":"yes"}}'),
      { deep: true },
    );

    expect(({} as any).polluted).toBeUndefined();
    expect(await fs.files.getJson(at("c.json"))).toEqual({ a: 1 });
  });

  it("strips a dangerous key nested below the top level", async () => {
    await fs.files.putJson(at("c.json"), { settings: { theme: "dark" } });

    await fs.files.mergeJson(
      at("c.json"),
      JSON.parse('{"settings":{"__proto__":{"isAdmin":true},"theme":"light"}}'),
      { deep: true },
    );

    expect(({} as any).isAdmin).toBeUndefined();
    expect(await fs.files.get(at("c.json"))).not.toContain("__proto__");
    expect(await fs.files.getJson(at("c.json"))).toEqual({ settings: { theme: "light" } });
  });

  it("strips a dangerous key inside an array element", async () => {
    await fs.files.putJson(at("c.json"), { items: [] });

    await fs.files.mergeJson(at("c.json"), JSON.parse('{"items":[{"__proto__":{"isAdmin":true}}]}'), {
      deep: true,
    });

    expect(({} as any).isAdmin).toBeUndefined();
    expect(await fs.files.get(at("c.json"))).not.toContain("__proto__");
    expect(await fs.files.getJson(at("c.json"))).toEqual({ items: [{}] });
  });

  /**
   * The poisoned side can be the file, not the caller: another process (or an
   * earlier, unguarded version of this library) may have written a `__proto__`
   * key that only becomes a pollution primitive when it is merged.
   */
  it("strips a __proto__ key that was already on disk", async () => {
    await fs.files.put(at("c.json"), '{"__proto__":{"isAdmin":true},"a":1}');

    await fs.files.mergeJson(at("c.json"), { b: 2 } as any, { deep: true });

    expect(({} as any).isAdmin).toBeUndefined();
    expect(await fs.files.get(at("c.json"))).not.toContain("__proto__");
    expect(await fs.files.getJson(at("c.json"))).toEqual({ a: 1, b: 2 });
  });

  it("guards File#mergeJson on the same path", async () => {
    const file = new File(at("c.json"));
    await file.putJson({ a: 1 });

    await file.mergeJson(JSON.parse('{"__proto__":{"isAdmin":true}}'), { deep: true });

    expect(({} as any).isAdmin).toBeUndefined();
    expect(await file.getJson()).toEqual({ a: 1 });
  });

  it("still merges nested objects and keeps non-literal values serializable", async () => {
    const when = new Date("2020-01-02T03:04:05.000Z");

    await fs.files.putJson(at("c.json"), { nested: { x: 1, y: 2 } });
    await fs.files.mergeJson(at("c.json"), { nested: { y: 99 }, when } as any, { deep: true });

    expect(await fs.files.getJson(at("c.json"))).toEqual({
      nested: { x: 1, y: 99 },
      when: when.toISOString(),
    });
  });
});
