import { describe, expectTypeOf, it } from "vitest";
import type { ScopedStorage } from "./scoped-storage";
import type { Storage } from "./storage";
import type { StorageManagerContract } from "./types";

/**
 * FW-12: `storage.use(name)` returned `ScopedStorageContract`, which omits the
 * directory operations the returned `ScopedStorage` has, so
 * `storage.use("private").deleteDirectory(...)` did not type-check. Type-level
 * only: `pnpm typecheck` compiles this file.
 */
describe("storage.use() typing (FW-12)", () => {
  it("is typed as the ScopedStorage it returns", () => {
    expectTypeOf<ReturnType<Storage["use"]>>().toEqualTypeOf<ScopedStorage>();
    expectTypeOf<ReturnType<StorageManagerContract["use"]>>().toEqualTypeOf<ScopedStorage>();
  });

  it("exposes the directory and URL operations", () => {
    type Scoped = ReturnType<Storage["use"]>;

    expectTypeOf<Scoped>().toHaveProperty("deleteDirectory");
    expectTypeOf<Scoped>().toHaveProperty("copyDirectory");
    expectTypeOf<Scoped>().toHaveProperty("moveDirectory");
    expectTypeOf<Scoped>().toHaveProperty("emptyDirectory");
    expectTypeOf<Scoped>().toHaveProperty("putFromUrl");
    expectTypeOf<Scoped>().toHaveProperty("prepend");
    expectTypeOf<Scoped>().toHaveProperty("append");
  });
});
