import { describe, expect, it } from "vitest";
import { configKeyFromPath } from "../config/config-key-from-path";
import {
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
    [isLocaleFile, "src/app/modules/blog/utils/locales.ts", false],
    [isConfigFile, "src/config/rate-limit.ts", true],
    [isConfigFile, "src/config/mail/smtp.ts", true],
  ])("%p %s -> %s", (predicate, path, expected) => {
    expect(predicate(path)).toBe(expected);
  });
});
