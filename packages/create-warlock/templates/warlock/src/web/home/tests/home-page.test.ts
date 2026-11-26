/** Proves the home page follows the reading direction and renders its form controls in each language. */
import { testGet } from "@warlock.js/core/tests";
import { describe, expect, it } from "vitest";

async function html(locale: string) {
  const response = await testGet("/", { headers: { cookie: `locale=${locale}` } });

  return response.text();
}

describe("home page in each language", () => {
  // @proves design-system/components AC-1
  it("renders every form control in English and in Arabic", async () => {
    for (const locale of ["en", "ar"]) {
      const page = await html(locale);

      expect(page).toContain(`lang="${locale}"`);
      expect(page).toContain('name="name"');
      expect(page).toContain('name="email"');
      expect(page).toContain('name="message"');
    }
  });

  // @proves design-system/direction AC-2
  it("mirrors the page in Arabic", async () => {
    expect(await html("ar")).toContain('dir="rtl"');
    expect(await html("en")).toContain('dir="ltr"');
  });
});
