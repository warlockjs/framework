import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  Directory,
  File,
  JsonSchemaValidationError,
  fs,
  type StandardSchemaV1,
} from "../src/index";
import { withTempDir } from "./helpers";

/** A tiny Standard Schema validator (no seal/zod dep) for getJson tests. */
const numberSchema: StandardSchemaV1<number> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      typeof value === "number" ? { value } : { issues: [{ message: "expected a number" }] },
  },
};

describe("fs.files facade", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const at = (...p: string[]) => path.join(dir, ...p);

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });
  afterEach(() => cleanup());

  it("put/get round-trips text (and creates parents)", async () => {
    await fs.files.put(at("a/b/c.txt"), "hi");
    expect(await fs.files.get(at("a/b/c.txt"))).toBe("hi");
  });

  it("get with encoding:null returns a Buffer", async () => {
    await fs.files.put(at("bin"), "hi");
    const buf = await fs.files.get(at("bin"), { encoding: null });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect((buf as Buffer).toString()).toBe("hi");
  });

  it("put { atomic } and Buffer content both write correctly", async () => {
    await fs.files.put(at("atomic.txt"), "x", { atomic: true });
    expect(await fs.files.get(at("atomic.txt"))).toBe("x");
    await fs.files.put(at("buf.bin"), Buffer.from("bytes"));
    expect((await fs.files.get(at("buf.bin"), { encoding: null }) as Buffer).toString()).toBe("bytes");
  });

  it("create refuses to overwrite; put overwrites", async () => {
    await fs.files.create(at("once.txt"), "first");
    await expect(fs.files.create(at("once.txt"), "second")).rejects.toThrow(/overwrite/i);
    await fs.files.put(at("once.txt"), "second");
    expect(await fs.files.get(at("once.txt"))).toBe("second");
  });

  it("putJson honors indent; getJson round-trips", async () => {
    await fs.files.putJson(at("d.json"), { a: 1 }, { indent: 4 });
    expect(await fs.files.get(at("d.json"))).toBe('{\n    "a": 1\n}');
    expect(await fs.files.getJson(at("d.json"))).toEqual({ a: 1 });
  });

  it("getJson validates against a Standard Schema, and returns default when missing", async () => {
    await fs.files.putJson(at("n.json"), 42);
    expect(await fs.files.getJson(at("n.json"), { schema: numberSchema })).toBe(42);

    await fs.files.putJson(at("s.json"), "nope");
    await expect(fs.files.getJson(at("s.json"), { schema: numberSchema })).rejects.toBeInstanceOf(
      JsonSchemaValidationError,
    );

    expect(await fs.files.getJson(at("missing.json"), { default: { fallback: true } })).toEqual({
      fallback: true,
    });
  });

  it("append / prepend / appendLine / appendJsonLine", async () => {
    await fs.files.append(at("log"), "a");
    await fs.files.append(at("log"), "b");
    expect(await fs.files.get(at("log"))).toBe("ab");

    await fs.files.prepend(at("log"), "Z");
    expect(await fs.files.get(at("log"))).toBe("Zab");

    await fs.files.appendLine(at("lines"), "one");
    await fs.files.appendLine(at("lines"), "two");
    expect(await fs.files.get(at("lines"))).toBe("one\ntwo\n");

    await fs.files.appendJsonLine(at("nd.ndjson"), { a: 1 });
    await fs.files.appendJsonLine(at("nd.ndjson"), { b: 2 });
    expect(await fs.files.get(at("nd.ndjson"))).toBe('{"a":1}\n{"b":2}\n');
  });

  it("size / isEmpty", async () => {
    await fs.files.put(at("empty"), "");
    await fs.files.put(at("full"), "abc");
    expect(await fs.files.size(at("full"))).toBe(3);
    expect(await fs.files.isEmpty(at("empty"))).toBe(true);
    expect(await fs.files.isEmpty(at("full"))).toBe(false);
  });

  it("ensure creates-if-missing but never truncates; touch bumps mtime", async () => {
    await fs.files.put(at("keep.txt"), "content");
    await fs.files.ensure(at("keep.txt"));
    expect(await fs.files.get(at("keep.txt"))).toBe("content"); // not truncated
    await fs.files.ensure(at("new.txt"));
    expect(await fs.files.get(at("new.txt"))).toBe("");
    await fs.files.touch(at("touched.txt"));
    expect(await fs.files.exists(at("touched.txt"))).toBe(true);
  });

  it("edit / editJson transform in place", async () => {
    await fs.files.put(at("v.txt"), "4.6.0");
    await fs.files.edit(at("v.txt"), (c) => c.replace("4.6", "4.7"));
    expect(await fs.files.get(at("v.txt"))).toBe("4.7.0");

    await fs.files.putJson(at("pkg.json"), { name: "x", version: "1.0.0" });
    await fs.files.editJson<{ name: string; version: string }>(at("pkg.json"), (p) => ({
      ...p,
      version: "2.0.0",
    }));
    expect(await fs.files.getJson(at("pkg.json"))).toEqual({ name: "x", version: "2.0.0" });
  });

  it("mergeJson shallow + deep; ensureJson get-or-create", async () => {
    await fs.files.putJson(at("c.json"), { a: 1, nested: { x: 1, y: 2 } });
    await fs.files.mergeJson(at("c.json"), { a: 9 });
    expect(await fs.files.getJson(at("c.json"))).toEqual({ a: 9, nested: { x: 1, y: 2 } });

    await fs.files.mergeJson(at("c.json"), { nested: { y: 99 } } as any, { deep: true });
    expect(await fs.files.getJson(at("c.json"))).toEqual({ a: 9, nested: { x: 1, y: 99 } });

    // shallow would have replaced `nested` wholesale:
    await fs.files.mergeJson(at("c.json"), { nested: { z: 1 } } as any);
    expect(await fs.files.getJson(at("c.json"))).toEqual({ a: 9, nested: { z: 1 } });

    const created = await fs.files.ensureJson(at("cfg.json"), { fresh: true });
    expect(created).toEqual({ fresh: true });
    expect(await fs.files.getJson(at("cfg.json"))).toEqual({ fresh: true });
    const existing = await fs.files.ensureJson(at("cfg.json"), { fresh: false });
    expect(existing).toEqual({ fresh: true }); // did not overwrite
  });

  it("checksumMatches + readLines", async () => {
    await fs.files.put(at("f"), "hello");
    const digest = await fs.files.hash(at("f"));
    expect(await fs.files.checksumMatches(at("f"), digest.toUpperCase())).toBe(true);
    expect(await fs.files.checksumMatches(at("f"), "deadbeef")).toBe(false);

    await fs.files.put(at("multi"), "l1\nl2\nl3");
    const lines: string[] = [];
    for await (const line of fs.files.readLines(at("multi"))) lines.push(line);
    expect(lines).toEqual(["l1", "l2", "l3"]);
  });

  it("copy / move (creates dest parent) / stats", async () => {
    await fs.files.put(at("src.txt"), "data");
    await fs.files.copy(at("src.txt"), at("copied/out.txt"));
    expect(await fs.files.get(at("copied/out.txt"))).toBe("data");

    await fs.files.move(at("src.txt"), at("moved/out.txt"));
    expect(await fs.files.exists(at("src.txt"))).toBe(false);
    expect(await fs.files.get(at("moved/out.txt"))).toBe("data");

    const st = await fs.files.stats(at("moved/out.txt"));
    expect(st.type).toBe("file");
    expect(st.size).toBe(4);
    expect(st.name).toBe("out.txt");
    expect(st.lastModified).toBeInstanceOf(Date);
  });
});

describe("fs.dirs facade", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const at = (...p: string[]) => path.join(dir, ...p);

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });
  afterEach(() => cleanup());

  it("ensure / exists / isEmpty / count", async () => {
    await fs.dirs.ensure(at("d"));
    expect(await fs.dirs.exists(at("d"))).toBe(true);
    expect(await fs.dirs.isEmpty(at("d"))).toBe(true);
    await fs.files.put(at("d/a.txt"), "1");
    await fs.files.put(at("d/b.txt"), "2");
    expect(await fs.dirs.count(at("d"))).toBe(2);
    expect(await fs.dirs.isEmpty(at("d"))).toBe(false);
  });

  it("empty clears contents but keeps the dir", async () => {
    await fs.files.put(at("d/a.txt"), "1");
    await fs.files.put(at("d/sub/b.txt"), "2");
    await fs.dirs.empty(at("d"));
    expect(await fs.dirs.exists(at("d"))).toBe(true);
    expect(await fs.dirs.isEmpty(at("d"))).toBe(true);
  });

  it("list / listFiles / listDirs, single-level and recursive", async () => {
    await fs.files.put(at("root/a.txt"), "1");
    await fs.files.put(at("root/sub/b.txt"), "2");
    await fs.dirs.ensure(at("root/emptysub"));

    expect((await fs.dirs.listFiles(at("root"))).map((p) => path.basename(p))).toEqual(["a.txt"]);
    expect((await fs.dirs.listDirs(at("root"))).map((p) => path.basename(p)).sort()).toEqual([
      "emptysub",
      "sub",
    ]);
    const recursiveFiles = (await fs.dirs.listFiles(at("root"), { recursive: true })).map((p) =>
      path.basename(p),
    );
    expect(recursiveFiles.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("walk yields typed entries; size sums the tree", async () => {
    await fs.files.put(at("t/a.txt"), "aa"); // 2 bytes
    await fs.files.put(at("t/sub/b.txt"), "bbb"); // 3 bytes
    const entries: string[] = [];
    for await (const e of fs.dirs.walk(at("t"))) entries.push(`${e.type}:${e.name}`);
    expect(entries.sort()).toEqual(["directory:sub", "file:a.txt", "file:b.txt"]);
    expect(await fs.dirs.size(at("t"))).toBe(5);
  });

  it("hash is a stable fingerprint sensitive to content", async () => {
    await fs.files.put(at("x/a.txt"), "one");
    await fs.files.put(at("x/b.txt"), "two");
    await fs.files.put(at("y/a.txt"), "one");
    await fs.files.put(at("y/b.txt"), "two");
    expect(await fs.dirs.hash(at("x"))).toBe(await fs.dirs.hash(at("y")));
    await fs.files.put(at("y/b.txt"), "changed");
    expect(await fs.dirs.hash(at("x"))).not.toBe(await fs.dirs.hash(at("y")));
  });

  it("copy / move directories", async () => {
    await fs.files.put(at("a/f.txt"), "data");
    await fs.dirs.copy(at("a"), at("b"));
    expect(await fs.files.get(at("b/f.txt"))).toBe("data");
    await fs.dirs.move(at("a"), at("moved/a"));
    expect(await fs.dirs.exists(at("a"))).toBe(false);
    expect(await fs.files.get(at("moved/a/f.txt"))).toBe("data");
  });
});

describe("File / Directory handles + fs.exists", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const at = (...p: string[]) => path.join(dir, ...p);

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });
  afterEach(() => cleanup());

  it("File: path helpers are pure (no IO) and correct", () => {
    const f = fs.file(at("app/user.model.ts"));
    expect(f).toBeInstanceOf(File);
    expect(f.name).toBe("user.model.ts");
    expect(f.basename).toBe("user.model");
    expect(f.extension).toBe(".ts");
    expect(f.parent()).toBeInstanceOf(Directory);
    expect(f.parent().name).toBe("app");
  });

  it("File: read/write/editJson via handle", async () => {
    const f = fs.file(at("pkg.json"));
    await f.putJson({ name: "x", version: "1.0.0" });
    await f.editJson<{ name: string; version: string }>((p) => ({ ...p, version: "2.0.0" }));
    expect(await f.getJson()).toEqual({ name: "x", version: "2.0.0" });
  });

  it("File: move returns a NEW handle and does not mutate the original", async () => {
    const f = fs.file(at("a.txt"));
    await f.put("data");
    const moved = await f.moveTo(fs.dir(at("dest")));
    expect(f.path).toBe(at("a.txt")); // original handle unchanged
    expect(moved.path).toBe(at("dest/a.txt"));
    expect(await moved.get()).toBe("data");
    expect(await f.exists()).toBe(false);

    const renamed = await moved.rename("b.txt");
    expect(renamed.name).toBe("b.txt");
    expect(await renamed.get()).toBe("data");
  });

  it("Directory: child handles + listFiles returns File[]", async () => {
    const root = fs.dir(at("src"));
    await root.file("a.ts").put("//a");
    await root.dir("sub").file("b.ts").put("//b");

    const files = await root.listFiles({ recursive: true });
    expect(files.every((f) => f instanceof File)).toBe(true);
    expect(files.map((f) => f.name).sort()).toEqual(["a.ts", "b.ts"]);

    const subs = await root.listDirs();
    expect(subs[0]).toBeInstanceOf(Directory);
    expect(subs[0].name).toBe("sub");

    expect(await root.count()).toBe(2); // a.ts + sub
    expect(await root.isEmpty()).toBe(false);
  });

  it("fs.exists is type-agnostic", async () => {
    await fs.files.put(at("f.txt"), "x");
    await fs.dirs.ensure(at("d"));
    expect(await fs.exists(at("f.txt"))).toBe(true);
    expect(await fs.exists(at("d"))).toBe(true);
    expect(await fs.exists(at("nope"))).toBe(false);
  });

  it("fs.files.get() returns a string usable without a cast", async () => {
    await fs.files.put(at("s.txt"), "hello world");
    const text = await fs.files.get(at("s.txt")); // typed string via overload
    expect(text.includes("world")).toBe(true);
  });
});

describe("fs.hash", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  const at = (...p: string[]) => path.join(dir, ...p);

  beforeEach(async () => {
    ({ dir, cleanup } = await withTempDir());
  });
  afterEach(() => cleanup());

  it("string/buffer (sync) and file (async) agree for the same content", async () => {
    expect(fs.hash.string("abc")).toBe(fs.hash.buffer(Buffer.from("abc")));
    await fs.files.put(at("f.txt"), "abc");
    expect(await fs.hash.file(at("f.txt"))).toBe(fs.hash.string("abc"));
  });

  it("dir hash is a stable string", async () => {
    await fs.files.put(at("d/a.txt"), "x");
    expect(typeof (await fs.hash.dir(at("d")))).toBe("string");
  });
});
