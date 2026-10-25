import { afterEach, describe, expect, it } from "vitest";
import {
  crudCreateServiceStub,
  crudRepositoryStub,
  crudSeedStub,
  repositoryStub,
} from "../templates/stubs";
import { generatedBarrels, modelImportPath, setGeneratedBarrels } from "./barrels";
import { pluralName } from "./name-parser";

afterEach(() => setGeneratedBarrels(true));

describe("generated barrels", () => {
  it("are on by default and import the model folder", () => {
    expect(generatedBarrels()).toBe(true);
    expect(modelImportPath("post")).toBe("../models/post");
  });

  it("import the model file once barrels are off", () => {
    setGeneratedBarrels(false);

    expect(generatedBarrels()).toBe(false);
    expect(modelImportPath("post")).toBe("../models/post/post.model");
  });

  it("change the model import of every stub that names a model", () => {
    const entity = pluralName("post");
    const stubs = () => [
      crudRepositoryStub(entity),
      crudCreateServiceStub(entity),
      crudSeedStub(entity),
      repositoryStub(entity),
    ];

    for (const source of stubs()) {
      expect(source).toContain('from "../models/post";');
    }

    setGeneratedBarrels(false);

    for (const source of stubs()) {
      expect(source).toContain('from "../models/post/post.model";');
      expect(source).not.toContain('from "../models/post";');
    }
  });
});
