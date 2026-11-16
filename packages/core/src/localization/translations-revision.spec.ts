import {
  extend as libraryExtend,
  getKeywordsListOf,
  getTranslationsList,
  groupedTranslations as libraryGroupedTranslations,
} from "@mongez/localization";
import { describe, expect, it } from "vitest";
import {
  bumpTranslationsRevision,
  extend,
  getTranslationsRevision,
  groupedTranslations,
  setTranslationsList,
} from "./translations-revision";

describe("translations revision", () => {
  it("moves once per extend or groupedTranslations call made through core", () => {
    const start = getTranslationsRevision();

    extend("en", { revisionSpec: { a: "A" } });
    const afterExtend = getTranslationsRevision();

    groupedTranslations("revisionSpecGroup", { b: { en: "B" } });
    const afterGrouped = getTranslationsRevision();

    expect(afterExtend).toBe(start + 1);
    expect(afterGrouped).toBe(afterExtend + 1);
    expect(getKeywordsListOf("en")).toMatchObject({ revisionSpec: { a: "A" } });
  });

  it("moves once for direct @mongez/localization calls", () => {
    const start = getTranslationsRevision();

    libraryExtend("en", { directSpec: { a: "A" } });
    const afterExtend = getTranslationsRevision();

    libraryGroupedTranslations("directSpecGroup", { b: { en: "B" } });

    expect(afterExtend).toBe(start + 1);
    expect(getTranslationsRevision()).toBe(afterExtend + 1);
  });

  it("moves when the whole list is replaced, and on an explicit bump", () => {
    const list = getTranslationsList();
    const start = getTranslationsRevision();

    setTranslationsList(list);
    const afterSet = getTranslationsRevision();
    bumpTranslationsRevision();

    expect(afterSet).toBe(start + 1);
    expect(getTranslationsRevision()).toBe(afterSet + 1);
  });
});
