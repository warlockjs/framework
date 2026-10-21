import payload from "../design-system-payload.json" with { type: "json" };
import {
  ensureDirectoryAsync,
  fileExistsAsync,
  getFileAsync,
  getJsonFileAsync,
  putFileAsync,
  recordSkippedFile,
} from "../generation-fs";
import { dirname } from "node:path";
import { rootPath, srcPath } from "../../utils";
import { shadcnFeature } from "./shadcn.feature";
import type { FeatureDefinition } from "./types";

/** Run before dependency installation so refusal leaves the app untouched. */
export async function assertDesignSystemTailwind(): Promise<void> {
  const manifest = await getJsonFileAsync<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>(rootPath("package.json"));
  const css = (await fileExistsAsync(srcPath("web/app.css")))
    ? await getFileAsync(srcPath("web/app.css"))
    : "";
  const hasPackage = manifest.dependencies?.tailwindcss ?? manifest.devDependencies?.tailwindcss;
  if (!hasPackage || !/@import\s+["']tailwindcss["']/.test(css.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    throw new Error(
      "The design system needs Tailwind CSS in src/web/app.css. Please run `warlock add tailwind` first, then `warlock add design-system`.",
    );
  }
}

export const designSystemFeature: FeatureDefinition = {
  description:
    "Accessible shadcn/ui form controls wired to Mongez React Form; requires an existing Tailwind setup.",
  requires: ["web"],
  dependencies: payload.dependencies,
  async onExecuting(options) {
    await assertDesignSystemTailwind();
    await shadcnFeature.onExecuting?.(options);
    for (const [relativePath, content] of Object.entries(payload.files)) {
      const target = rootPath(relativePath);
      if (await fileExistsAsync(target)) {
        recordSkippedFile(target, "exists");
        continue;
      }
      await ensureDirectoryAsync(dirname(target));
      await putFileAsync(target, content);
    }
    console.log(
      "Design system controls are ready in src/web/design-system. Existing files were preserved.",
    );
  },
};
