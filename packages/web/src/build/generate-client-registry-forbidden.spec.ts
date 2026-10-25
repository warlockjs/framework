import { transform } from "esbuild";
import { describe, expect, it } from "vitest";
import { validateClientRouteManifest } from "../client/runtime/manifest";
import type { DiscoveredPage, DiscoveredRoutablePage } from "./discover-pages";
import { CLIENT_REGISTRY_EXPORT_NAME, generateClientRegistry } from "./generate-client-registry";

function toDataUrl(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source, "utf-8").toString("base64")}`;
}

function stubSpecifier(absoluteFilePath: string): string {
  return toDataUrl(
    `export const sourceFile = ${JSON.stringify(absoluteFilePath)};\n` +
      "export function register() {}\n" +
      "export default function Component() {}",
  );
}

async function evaluate(contents: string) {
  const { code } = await transform(contents, { loader: "ts", format: "esm" });
  const namespace = (await import(/* @vite-ignore */ toDataUrl(code))) as Record<string, unknown>;

  return validateClientRouteManifest(namespace[CLIENT_REGISTRY_EXPORT_NAME]);
}

const page: DiscoveredRoutablePage = {
  type: "page",
  routeName: "staff.home",
  routePath: "/staff",
  pageFile: "C:/app/src/web/staff.page.tsx",
  webRoot: "C:/app/src/web",
  layouts: [],
  middlewareLayouts: [],
};

const errorPage: DiscoveredPage = {
  type: "error",
  pageFile: "C:/app/src/web/error.page.tsx",
  webRoot: "C:/app/src/web",
};

const forbiddenPage: DiscoveredPage = {
  type: "forbidden",
  pageFile: "C:/app/src/web/forbidden.page.tsx",
  setupFile: "C:/app/src/web/forbidden.setup.ts",
  webRoot: "C:/app/src/web",
};

describe("generateClientRegistry: forbidden page", () => {
  it("projects the forbidden page into every route's composition next to ErrorPage", async () => {
    const contents = generateClientRegistry({
      pages: [page, errorPage, forbiddenPage],
      toImportSpecifier: stubSpecifier,
    });
    const [entry] = await evaluate(contents);
    const composition = await entry!.load();

    expect((composition.ErrorPage as { sourceFile: string }).sourceFile).toBe(
      "C:/app/src/web/error.page.tsx",
    );
    expect((composition.ForbiddenPage as { sourceFile: string }).sourceFile).toBe(
      "C:/app/src/web/forbidden.page.tsx",
    );
  });

  it("registers the forbidden page's setup module the way the error page's is", () => {
    const contents = generateClientRegistry({
      pages: [page, forbiddenPage],
      toImportSpecifier: (file) => `import:${file}`,
    });

    expect(contents).toContain("ForbiddenPageSetupModule");
    expect(contents).toContain("import:C:/app/src/web/forbidden.setup.ts?warlock-setup-register");
  });

  it("omits ForbiddenPage entirely when the app has none", async () => {
    const [entry] = await evaluate(
      generateClientRegistry({ pages: [page, errorPage], toImportSpecifier: stubSpecifier }),
    );
    const composition = await entry!.load();

    expect(Object.prototype.hasOwnProperty.call(composition, "ForbiddenPage")).toBe(false);
  });
});
