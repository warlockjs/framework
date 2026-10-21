import config from "@mongez/config";
import { getCurrentLocaleCode, setCurrentLocaleCode, trans } from "@mongez/localization";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadTestLocales } from "./test-locales";

it("registers module JSON translations in the calling worker and removes them on teardown", async () => {
  const root = await mkdtemp(join(tmpdir(), "warlock-test-locales-"));
  const previous = getCurrentLocaleCode();
  const codes = config.get("app.localeCodes");
  let cleanup: (() => void) | undefined;
  try {
    const directory = join(root, "src/app/messages/utils");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "locales.json"),
      JSON.stringify({ title: { en: "Messages", ar: "الرسائل" } }),
    );
    config.set("app.localeCodes", ["en", "ar"]);
    cleanup = await loadTestLocales(root);
    setCurrentLocaleCode("en");
    expect(trans("messages.title")).toBe("Messages");
    setCurrentLocaleCode("ar");
    expect(trans("messages.title")).toBe("الرسائل");
    cleanup();
    expect(trans("messages.title")).toBe("messages.title");
  } finally {
    cleanup?.();
    config.set("app.localeCodes", codes);
    setCurrentLocaleCode(previous);
    await rm(root, { recursive: true, force: true });
  }
});
