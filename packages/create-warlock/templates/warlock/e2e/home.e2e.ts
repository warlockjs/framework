import { defineE2E, defaultViewports } from "@warlock.js/core/e2e";

export default defineE2E({
  app: {
    build: [process.execPath, "node_modules/@warlock.js/core/bin/warlock.js", "build"],
    start: [process.execPath, "dist/app.js"],
    exclude: ["storage", "data"],
  },
  run: async ({ page }) => {
    for (const viewport of defaultViewports) {
      await page.setViewport(viewport);
      await page.goto("/");
      await page.waitFor({ selector: "main" });
      await page.assertAccessible();
      await page.assertViewport();
      await page.screenshot("home");
    }
  },
});
