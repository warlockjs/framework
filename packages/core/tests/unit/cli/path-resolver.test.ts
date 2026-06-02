import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveComponentPath,
  resolveModulePath,
} from "../../../src/cli/commands/generate/utils/path-resolver";

/**
 * Unit coverage for the generator path resolvers. Both build absolute paths
 * under `src/app` (via `appPath`, which is rooted at `process.cwd()`); the
 * resolvers compose module + type + name + extension deterministically.
 */
const appRoot = path.resolve(process.cwd(), "src/app");

describe("resolveModulePath", () => {
  it("resolves a module directory under src/app", () => {
    expect(resolveModulePath("users")).toBe(path.join(appRoot, "users"));
  });
});

describe("resolveComponentPath", () => {
  it("composes module/type/name with the default .ts extension", () => {
    expect(resolveComponentPath("users", "controllers", "create-user.controller")).toBe(
      path.join(appRoot, "users", "controllers", "create-user.controller.ts"),
    );
  });

  it("honors a custom extension", () => {
    expect(resolveComponentPath("users", "services", "create-user.service", ".tsx")).toBe(
      path.join(appRoot, "users", "services", "create-user.service.tsx"),
    );
  });

  it("places the file inside the type folder of the module", () => {
    const resolved = resolveComponentPath("posts", "repositories", "posts.repository");

    expect(resolved.startsWith(path.join(appRoot, "posts", "repositories"))).toBe(true);
    expect(resolved.endsWith("posts.repository.ts")).toBe(true);
  });
});
