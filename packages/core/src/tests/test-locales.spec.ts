import config from "@mongez/config";
import { getCurrentLocaleCode, setCurrentLocaleCode, trans } from "@mongez/localization";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadTestLocales } from "./test-locales";

it("merges per-feature locale files into the module namespace in the calling worker", async () => {
  const root = await mkdtemp(join(tmpdir(), "warlock-test-locales-"));
  const previous = getCurrentLocaleCode();
  const codes = config.get("app.localeCodes");
  let cleanup: (() => void) | undefined;
  try {
    const directory = join(root, "src/app/orders/utils");
    await mkdir(join(directory, "locales"), { recursive: true });
    await writeFile(join(directory, "locales.json"), JSON.stringify({ title: { en: "Orders" } }));
    await writeFile(
      join(directory, "locales", "refunds.json"),
      JSON.stringify({ refunded: { en: "Refunded" } }),
    );
    config.set("app.localeCodes", ["en"]);
    cleanup = await loadTestLocales(root);
    setCurrentLocaleCode("en");
    expect(trans("orders.title")).toBe("Orders");
    expect(trans("orders.refunded")).toBe("Refunded");
    cleanup();
    expect(trans("orders.refunded")).toBe("orders.refunded");
  } finally {
    cleanup?.();
    config.set("app.localeCodes", codes);
    setCurrentLocaleCode(previous);
    await rm(root, { recursive: true, force: true });
  }
});

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
