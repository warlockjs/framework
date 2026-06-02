import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateController } from "../../../src/cli/commands/generate/generators/controller.generator";
import { generateModel } from "../../../src/cli/commands/generate/generators/model.generator";
import { generateRepository } from "../../../src/cli/commands/generate/generators/repository.generator";
import { generateResource } from "../../../src/cli/commands/generate/generators/resource.generator";
import { setDryRun } from "../../../src/cli/commands/generate/utils/writer";
import type { CommandActionData } from "../../../src/cli/types";

/**
 * End-to-end OUTPUT tests for the module-gated component generators that the
 * existing suites do not drive to disk: model, repository, resource. Plus the
 * cross-cutting branches every component generator shares — the already-exists
 * exit, the `--force` overwrite, and the controller's `--withValidation` schema
 * emission.
 *
 * Each test chdir's into a throwaway temp dir, pre-creates the `users` module
 * directory so the `moduleExists` gate passes, runs the generator, then asserts
 * the emitted files. Sources: core/src/cli/commands/generate/generators/*.
 */
const data = (args: string[], options: CommandActionData["options"] = {}): CommandActionData => ({
  args,
  options,
});

const appPathFor = (...segments: string[]) => path.join(process.cwd(), "src", "app", ...segments);

class ProcessExitError extends Error {
  public constructor(public readonly code?: number) {
    super(`process.exit(${code})`);
  }
}

let tempDir: string;
let originalCwd: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let exitSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  originalCwd = process.cwd();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "warlock-gen-comp-"));
  process.chdir(tempDir);

  // Pre-create the module directory so the directory-existence gate passes.
  await mkdir(appPathFor("users"), { recursive: true });

  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code);
  }) as never);
});

afterEach(async () => {
  setDryRun(false);
  consoleSpy.mockRestore();
  exitSpy.mockRestore();
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("generateModel — output", () => {
  it("writes the model, its index barrel, and a timestamped migration", async () => {
    await expect(generateModel(data(["users/user"]))).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    const modelDir = appPathFor("users", "models", "user");
    const model = await readFile(path.join(modelDir, "user.model.ts"), "utf-8");
    const index = await readFile(path.join(modelDir, "index.ts"), "utf-8");
    const migrations = await readdir(path.join(modelDir, "migrations"));

    expect(model).toContain("export class User extends Model<UserType>");
    expect(model).toContain('public static table = "users"');
    expect(index).toContain('export * from "./user.model"');
    expect(migrations).toHaveLength(1);
    expect(migrations[0]).toMatch(/_user\.migration\.ts$/);
  });

  it("singularizes a plural entity name for the class and model folder", async () => {
    await generateModel(data(["users/categories"]));

    const model = await readFile(
      appPathFor("users", "models", "category", "category.model.ts"),
      "utf-8",
    );

    expect(model).toContain("export class Category extends Model");
    // The default table name uses the real pluralizer (`name.plural.snake`),
    // matching the model stub's own default — so the singular "category"
    // pluralizes back to "categories" rather than a naive "categorys".
    // Source: core/src/cli/commands/generate/generators/model.generator.ts:38.
    expect(model).toContain('public static table = "categories"');
  });

  it("honours an explicit --table name", async () => {
    await generateModel(data(["users/user"], { table: "accounts" }));

    const model = await readFile(appPathFor("users", "models", "user", "user.model.ts"), "utf-8");

    expect(model).toContain('public static table = "accounts"');
  });

  it("wires the resource import when --withResource is set", async () => {
    await generateModel(data(["users/user"], { withResource: true }));

    const model = await readFile(appPathFor("users", "models", "user", "user.model.ts"), "utf-8");

    expect(model).toContain("public static resource = UserResource;");
    expect(model).toContain("resources/user.resource");
  });

  it("emits a timestamps:false migration when --timestamps=false", async () => {
    await generateModel(data(["users/user"], { timestamps: "false" }));

    const dir = appPathFor("users", "models", "user", "migrations");
    const files = await readdir(dir);
    const migration = await readFile(path.join(dir, files[0]), "utf-8");

    expect(migration).toContain("{ timestamps: false }");
  });
});

describe("generateRepository — output", () => {
  it("writes the repository with the plural manager and singular source", async () => {
    await expect(generateRepository(data(["users/user"]))).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    const repo = await readFile(
      appPathFor("users", "repositories", "user.repository.ts"),
      "utf-8",
    );

    expect(repo).toContain("export class UsersRepository extends RepositoryManager<User");
    expect(repo).toContain("public source = User;");
    expect(repo).toContain("export const usersRepository = new UsersRepository();");
    expect(repo).toContain('import { User } from "../models/user"');
  });
});

describe("generateResource — output", () => {
  it("writes the resource class extending Resource", async () => {
    await expect(generateResource(data(["users/user"]))).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();

    const resource = await readFile(
      appPathFor("users", "resources", "user.resource.ts"),
      "utf-8",
    );

    expect(resource).toContain('import { Resource } from "@warlock.js/core"');
    expect(resource).toContain("export class UserResource extends Resource");
  });
});

describe("controller --withValidation", () => {
  it("emits the controller plus its schema and binds the validation", async () => {
    await generateController(data(["users/create-user"], { withValidation: true }));

    const controller = await readFile(
      appPathFor("users", "controllers", "create-user.controller.ts"),
      "utf-8",
    );
    const schema = await readFile(appPathFor("users", "schema", "create-user.schema.ts"), "utf-8");

    expect(controller).toContain("GuardedRequestHandler<CreateUserSchema>");
    expect(controller).toContain("createUserController.validation = {");
    expect(schema).toContain("export const createUserSchema = v.object({");
  });

  it("does NOT emit a schema file without the flag", async () => {
    await generateController(data(["users/create-user"]));

    await expect(readdir(appPathFor("users", "schema"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("component generators — already-exists gate and --force", () => {
  it("exits when the component already exists and --force is absent", async () => {
    await generateResource(data(["users/user"]));

    await expect(generateResource(data(["users/user"]))).rejects.toBeInstanceOf(ProcessExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("overwrites an existing component when --force is set", async () => {
    await generateResource(data(["users/user"]));

    await expect(generateResource(data(["users/user"], { force: true }))).resolves.toBeUndefined();
    // Only the second (forced) call reached the write path without exiting.
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe("component generators — dry run writes nothing", () => {
  it("generateRepository in dry-run leaves no repositories folder", async () => {
    await generateRepository(data(["users/user"], { dryRun: true }));

    await expect(readdir(appPathFor("users", "repositories"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
