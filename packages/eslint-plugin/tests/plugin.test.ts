import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, expect, it } from "vitest";
import plugin, { configs, DOCS_BASE_URL, rules } from "../src";

describe("@warlock.js/eslint-plugin", () => {
  it("documents every rule under the docs site", () => {
    for (const [name, rule] of Object.entries(rules)) {
      expect(rule.meta?.docs?.url).toBe(`${DOCS_BASE_URL}${name}/`);
      expect(rule.meta?.docs?.description).toBeTruthy();
    }
  });

  it("ships recommended and strict flat configs that reference real rules", () => {
    for (const config of [configs.recommended, configs.strict]) {
      expect(config.plugins?.["@warlock.js"]).toBe(plugin);
      for (const name of Object.keys(config.rules ?? {})) {
        expect(name.startsWith("@warlock.js/")).toBe(true);
        expect(Object.keys(rules)).toContain(name.slice("@warlock.js/".length));
      }
    }
    expect(Object.keys(configs.strict.rules ?? {}).sort()).toEqual(
      Object.keys(rules)
        .map((name) => `@warlock.js/${name}`)
        .sort(),
    );
  });

  it("lints a controller through the recommended preset", () => {
    const linter = new Linter({ configType: "flat" });
    const messages = linter.verify(
      [
        "import { router } from '@warlock.js/core';",
        "import { Post } from './post.model.js';",
        "router.post('/posts', async ({ request, response }) => {",
        "  await log.info('posts', 'create', `by ${request.input('email')}`);",
        "  const post = await Post.create(request.all());",
        "  return response.redirect(request.input('next'));",
        "});",
      ].join("\n"),
      [{ files: ["**/*.ts"], languageOptions: { parser: tsParser } }, configs.recommended],
      "src/app/posts/routes.ts",
    );

    expect(messages.map((message) => message.ruleId).sort()).toEqual([
      "@warlock.js/no-await-log",
      "@warlock.js/no-js-import-extension",
      "@warlock.js/no-request-all",
      "@warlock.js/no-sensitive-log",
      "@warlock.js/require-route-guard",
      "@warlock.js/safe-redirect",
    ]);
  });
});
