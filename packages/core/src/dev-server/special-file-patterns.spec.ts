import { describe, expect, it } from "vitest";
import { configKeyFromPath } from "../config/config-key-from-path";
import {
  isCodeFile,
  isConfigFile,
  isEventFile,
  isLocaleFile,
  isMainFile,
  isRouteFile,
} from "./special-file-patterns";

describe("configKeyFromPath", () => {
  it.each([
    ["src/config/rate-limit.ts", "rate-limit"],
    ["src/config/mail/smtp.ts", "mail/smtp"],
    ["src/config/app.tsx", "app"],
    ["src\\config\\mail\\smtp.ts", "mail/smtp"],
    ["src/app/users/routes.ts", undefined],
  ])("%s -> %s", (path, key) => {
    expect(configKeyFromPath(path)).toBe(key);
  });
});

describe("special file patterns", () => {
  it.each([
    [isRouteFile, "src/app/blog/routes.ts", true],
    [isRouteFile, "src/app/modules/blog/routes.ts", false],
    [isRouteFile, "src/app/blog/helpers/routes.ts", false],
    [isMainFile, "src/app/main.ts", true],
    [isMainFile, "src/app/blog/main.ts", true],
    [isMainFile, "src/app/blog/deep/main.ts", false],
    [isEventFile, "src/app/blog/events/on-post.ts", true],
    [isEventFile, "src/app/modules/blog/events/on-post.ts", false],
    [isLocaleFile, "src/app/blog/utils/locales.ts", true],
    [isLocaleFile, "src/app/blog/utils/locales.json", true],
    [isLocaleFile, "src/app/blog/utils/locales/comments.json", true],
    [isLocaleFile, "src/app/blog/utils/locales/comments.ts", false],
    [isLocaleFile, "src/app/blog/utils/locales/nested/comments.json", false],
    [isLocaleFile, "src/app/modules/blog/utils/locales.ts", false],
    [isConfigFile, "src/config/rate-limit.ts", true],
    [isConfigFile, "src/config/example.spec.ts", false],
    [isConfigFile, "src/config/example.test.tsx", false],
    [isConfigFile, "src/config/__tests__/example.ts", false],
    [isConfigFile, "src/config/mail/tests/example.ts", false],
    [isConfigFile, "src/config/fixtures/example.ts", false],
    [isConfigFile, "src\\config\\__mocks__\\mail.ts", false],
    [isConfigFile, "src/config/tests.ts", true],
    [isConfigFile, "src/config/mail/smtp.ts", true],
  ])("%p %s -> %s", (predicate, path, expected) => {
    expect(predicate(path)).toBe(expected);
  });
});

describe("special file patterns skip spec and test files", () => {
  it.each([
    [isMainFile, "src/app/blog/main.spec.ts"],
    [isRouteFile, "src/app/blog/routes.test.ts"],
    [isEventFile, "src/app/blog/events/on-post.spec.ts"],
    [isEventFile, "src/app/blog/events/on-post.test.tsx"],
    [isLocaleFile, "src/app/blog/utils/locales.spec.ts"],
    [isConfigFile, "src/config/app.spec.ts"],
  ])("%p rejects %s", (predicate, path) => {
    expect(predicate(path)).toBe(false);
  });
});

describe("isCodeFile", () => {
  it.each([
    ["src/app/a.ts", true],
    ["src/app/a.mjs", true],
    ["fixtures/seed.sql", false],
    ["src/data/config.json", false],
  ])("%s -> %s", (path, expected) => {
    expect(isCodeFile(path)).toBe(expected);
  });
});
