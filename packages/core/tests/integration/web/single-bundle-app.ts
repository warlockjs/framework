import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { linkWorkspaceDependencies, workspace } from "./two-site-app";

/** The route the fixture's server module answers. */
export const SINGLE_BUNDLE_ROUTE = "/api/ping";

/** Text each fixture page renders, asserted by the build and boot checks. */
export const SINGLE_BUNDLE_MARKERS = {
  home: "single bundle home",
  about: "single bundle about",
  lazy: "single bundle lazy",
} as const;

export type SingleBundleAppOptions = {
  /** `build` block written into `warlock.config.ts`, as source text. */
  build: string;
  /** `webConnector` options written into `warlock.config.ts`, as source text appended to the base ones. */
  web?: string;
};

/**
 * Write a small Warlock Web app that can be built with `warlock build`:
 * a root, a layout, two pages, a page that lazy-loads a component, a server
 * route and one native-free dependency (`dayjs`).
 *
 * The framework resolves from its sources through tsconfig paths and Vite
 * aliases, like the other web integration fixtures, so the fixture needs a
 * linked `node_modules` to BUILD. The built `dist/` must not.
 */
export async function writeSingleBundleApp(
  directory: string,
  options: SingleBundleAppOptions,
): Promise<void> {
  const paths: Record<string, string[]> = {};
  const aliases: { find: string; replacement: string }[] = [];

  for (const name of [
    "seal",
    "cascade",
    "context",
    "logger",
    "cache",
    "fs",
    "herald",
    "sitemap",
    "web",
    "core",
  ]) {
    const entry = join(workspace, "packages", name, "src/index.ts");

    paths[`@warlock.js/${name}`] = [entry];
    paths[`@warlock.js/${name}/*`] = [join(workspace, "packages", name, "src/*")];

    if (name === "web") aliases.push({ find: `@warlock.js/${name}`, replacement: entry });
  }

  aliases.unshift({
    find: "@warlock.js/web/client/runtime",
    replacement: join(workspace, "packages/web/src/client/runtime/index.ts"),
  });
  paths["@warlock.js/web/connector"] = [join(workspace, "packages/web/src/connector/index.ts")];

  await linkWorkspaceDependencies(directory);

  const write = async (file: string, content: string) => {
    await mkdir(dirname(join(directory, file)), { recursive: true });
    await writeFile(join(directory, file), content);
  };

  await write(
    "package.json",
    JSON.stringify({
      name: "single-bundle-fixture",
      type: "module",
      dependencies: {
        dayjs: "*",
        react: "*",
        "react-dom": "*",
        "@warlock.js/core": "*",
        "@warlock.js/web": "*",
      },
    }),
  );
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        jsx: "react-jsx",
        paths,
      },
    }),
  );
  await write(
    "warlock.config.ts",
    `import {defineConfig} from '@warlock.js/core';
import {webConnector} from '@warlock.js/web/connector';
export default defineConfig({
  build: ${options.build},
  devServer:{generateTypings:false,healthCheckers:false,checkForUpdates:false},
  connectors:[webConnector({webRoot:${JSON.stringify(join(workspace, "packages/web"))},resolveAlias:${JSON.stringify(aliases)}${options.web ?? ""}})],
});`,
  );
  await write("public/favicon.ico", "");
  await write(
    "src/config/http.ts",
    "export default {port:Number(process.env.HTTP_PORT ?? 0),host:'127.0.0.1',log:false};",
  );
  await write(
    "src/config/app.ts",
    "export default {localeCode:'en',localeCodes:['en'],baseUrl:'http://127.0.0.1:'+(process.env.HTTP_PORT ?? 0)};",
  );
  await write("src/config/web.ts", "export default {};");
  await write(
    "src/app/ping/routes.ts",
    `import {router} from '@warlock.js/core';
router.get('${SINGLE_BUNDLE_ROUTE}', ({response}) => response.success({ok:true}), {name:'ping.show'});`,
  );

  await write(
    "src/web/root.tsx",
    `import { Head, Scripts } from "@warlock.js/web";
import type { AppProps } from "@warlock.js/web";

export default function App({ children }: AppProps) {
  return (
    <html lang="en">
      <head><Head /></head>
      <body><div id="vessel">{children}</div><Scripts /></body>
    </html>
  );
}
`,
  );
  await write(
    "src/web/layout.tsx",
    `import type { LayoutProps } from "@warlock.js/web";

export default function Layout({ children }: LayoutProps) {
  return <div className="shell"><nav><a href="/">home</a> <a href="/about">about</a></nav>{children}</div>;
}
`,
  );
  await write(
    "src/web/index.page.tsx",
    `import dayjs from "dayjs";

export default function Home() {
  return <main><h1>${SINGLE_BUNDLE_MARKERS.home}</h1><p>{dayjs("2026-01-02").format("YYYY")}</p></main>;
}
`,
  );
  await write(
    "src/web/about.page.tsx",
    `export default function About() {
  return <main><h1>${SINGLE_BUNDLE_MARKERS.about}</h1></main>;
}
`,
  );
  await write(
    "src/web/lazy.page.tsx",
    `import { lazy, Suspense } from "react";
import { ClientOnly } from "@warlock.js/web";

const Widget = lazy(() => import("./widget"));

export default function LazyPage() {
  return (
    <main>
      <h1>${SINGLE_BUNDLE_MARKERS.lazy}</h1>
      <ClientOnly><Suspense fallback={null}><Widget /></Suspense></ClientOnly>
    </main>
  );
}
`,
  );
  await write(
    "src/web/widget.tsx",
    `export default function Widget() {
  return <aside>lazy widget</aside>;
}
`,
  );
}
