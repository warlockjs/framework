import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { withTempDir } from "./helpers";

// Platforms without O_NOFOLLOW (Windows) leave it out of `fs.constants`; the
// reader must still refuse a swapped entry through its identity check.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    constants: { ...original.constants, O_NOFOLLOW: undefined, O_NONBLOCK: undefined },
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, open: vi.fn(original.open) };
});

const { createConfinedReader, FsLinkRefusedError } = await import("../src");
const { open } = await import("node:fs/promises");
const original = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const realConstants = (await vi.importActual<typeof import("node:fs")>("node:fs")).constants;

const posixOnly = process.platform === "win32" ? describe.skip : describe;

posixOnly("confined reader — without O_NOFOLLOW", () => {
  let dir: string;
  let cleanup: () => Promise<void>;
  let root: string;
  let outside: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ dir, cleanup } = await withTempDir());
    root = path.join(dir, "root");
    outside = path.join(dir, "outside");
    await original.mkdir(root);
    await original.mkdir(outside);
    await original.writeFile(path.join(root, "data.txt"), "inside");
    await original.writeFile(path.join(outside, "secret.txt"), "top secret");
  });

  afterEach(async () => {
    vi.mocked(open).mockImplementation(original.open);
    await cleanup();
  });

  it("opens without the flag and still reads", async () => {
    expect(await createConfinedReader(root).readText("data.txt")).toBe("inside");

    const flags = Number(vi.mocked(open).mock.calls[0]?.[1]);

    expect(flags & realConstants.O_NOFOLLOW).toBe(0);
  });

  it("refuses a file swapped for a symlink through the identity check", async () => {
    const target = path.join(root, "data.txt");

    vi.mocked(open).mockImplementationOnce(async (file, flags) => {
      await original.rm(target);
      await original.symlink(path.join(outside, "secret.txt"), target);
      return original.open(file, flags);
    });

    const error = await createConfinedReader(root)
      .readText("data.txt")
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    expect(error).toBeInstanceOf(FsLinkRefusedError);
    expect(error).toMatchObject({ reason: "identity-changed", linkPath: "data.txt" });
  });
});
