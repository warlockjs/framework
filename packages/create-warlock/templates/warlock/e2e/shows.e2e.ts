import { defineE2E } from "@warlock.js/core/e2e";
import { shows } from "@warlock.js/grimoire/warlock";

const FORM = "#contact-demo";
const COMPONENTS = "[data-components]";
const VALID = { name: "Ada Lovelace", email: "ada@example.com", message: "Hello from a scene." };

/** Every input and textarea whose text does not follow the reading direction. */
const MISALIGNED = `(() =>
  [...document.querySelectorAll("input, textarea")]
    .filter((element) => {
      const style = getComputedStyle(element);
      const align = style.textAlign;

      return !(align === "start" || align === (style.direction === "rtl" ? "right" : "left"));
    })
    .map((element) => element.getAttribute("name") ?? element.tagName))()`;

export default defineE2E({
  app: {
    build: [process.execPath, "node_modules/@warlock.js/core/bin/warlock.js", "build"],
    start: [process.execPath, "dist/app.js"],
    exclude: ["storage", "data"],
  },
  // The failure scenes make /api/contact fail on purpose.
  allowNetworkFailures: [{ url: "/api/contact" }],
  allowConsoleErrors: [/api\/contact/, /Failed to load resource/],
  run: async (context) => {
    // @shows contact/send-message AC-1
    await shows(context, "contact/send-message AC-1", async ({ page, path }) => {
      await page.goto(path("/"));
      await page.waitFor({ selector: FORM });
      await page.fill(`${FORM} input[name="name"]`, VALID.name);
      await page.fill(`${FORM} input[name="email"]`, VALID.email);
      await page.fill(`${FORM} textarea[name="message"]`, VALID.message);
      await page.click(`${FORM} button[type="submit"]`);
      await page.waitFor({ selector: ".warlock-form-status.is-success" });
    });

    // @shows contact/send-message AC-2
    await shows(context, "contact/send-message AC-2", async ({ page, path }) => {
      await page.goto(path("/"));
      await page.waitFor({ selector: FORM });
      await page.fill(`${FORM} input[name="name"]`, VALID.name);
      await page.fill(`${FORM} input[name="email"]`, "not-an-email");
      await page.fill(`${FORM} textarea[name="message"]`, VALID.message);
      await page.click(`${FORM} button[type="submit"]`);
      await page.waitFor({ selector: `${FORM} .warlock-field-error` });
    });

    // @shows contact/send-message AC-3
    await shows(context, "contact/send-message AC-3", async ({ page, path }) => {
      await page.mockRequests([{ url: "/api/contact", fail: "unreachable" }]);
      await page.goto(path("/"));
      await page.waitFor({ selector: FORM });
      await page.fill(`${FORM} input[name="name"]`, VALID.name);
      await page.fill(`${FORM} input[name="email"]`, VALID.email);
      await page.fill(`${FORM} textarea[name="message"]`, VALID.message);
      await page.click(`${FORM} button[type="submit"]`);
      await page.waitFor({ selector: ".warlock-form-status.is-error" });
    });

    // @shows contact/send-message AC-4
    await shows(context, "contact/send-message AC-4", async ({ page, path }) => {
      await page.mockRequests([
        {
          url: "/api/contact",
          status: 500,
          body: { error: { code: "internal", message: "The server could not send your message. Try again in a moment." } },
        },
      ]);
      await page.goto(path("/"));
      await page.waitFor({ selector: FORM });
      await page.fill(`${FORM} input[name="name"]`, VALID.name);
      await page.fill(`${FORM} input[name="email"]`, VALID.email);
      await page.fill(`${FORM} textarea[name="message"]`, VALID.message);
      await page.click(`${FORM} button[type="submit"]`);
      await page.waitFor({ selector: ".warlock-form-status.is-error" });
    });

    // @shows design-system/components AC-1
    await shows(context, "design-system/components AC-1", async ({ page, path }) => {
      await page.goto(path("/dev/components"));
      await page.waitFor({ selector: COMPONENTS });
    });

    // @shows design-system/error-messages AC-1
    await shows(context, "design-system/error-messages AC-1", async ({ page, path }) => {
      await page.goto(path("/dev/components"));
      await page.waitFor({ selector: `${COMPONENTS} .warlock-field-error` });
    });

    // @shows design-system/direction AC-1
    await shows(context, "design-system/direction AC-1", async ({ page, path }) => {
      await page.goto(path("/dev/components"));
      await page.waitFor({ selector: COMPONENTS });

      const misaligned = await page.evaluate<string[]>(MISALIGNED);

      if (misaligned.length > 0) {
        throw new Error(`These controls do not align their text to the reading direction: ${misaligned.join(", ")}.`);
      }
    });

    // @shows design-system/direction AC-2
    await shows(context, "design-system/direction AC-2", async ({ page, language, path }) => {
      await page.goto(path("/dev/components"));
      await page.waitFor({ selector: COMPONENTS });

      const direction = await page.evaluate<string>(
        'getComputedStyle(document.querySelector("[data-components]")).direction',
      );
      const expected = language === "ar" ? "rtl" : "ltr";

      if (direction !== expected) {
        throw new Error(`The components page reads ${direction} in ${language}; it should read ${expected}.`);
      }
    });
  },
});
