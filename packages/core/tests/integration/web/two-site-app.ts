import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The monorepo root. */
export const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** Each site's hostname, in the order the app declares them. */
export const SITE_HOSTS = { landing: "landing.test", client: "client.test" } as const;

/** The route every page names with `apiHref`. */
export const NAMED_ROUTE = "ping.show";

const page = (site: string) => `import { apiHref } from "@warlock.js/web";

export default function Page() {
  return <main><h1>${site} home</h1><a href={apiHref("${NAMED_ROUTE}")}>ping</a></main>;
}
`;

/**
 * Link the dependencies the framework sources import into `directory/node_modules`.
 * The web package's alone are not enough: the HTTP test server loads
 * `warlock.config.ts` from the core source, which imports core's own dependencies.
 * The web package's entries win, then core's, then every other package's.
 */
async function linkWorkspaceDependencies(directory: string): Promise<void> {
  const target = join(directory, "node_modules");
  const owners = ["web", "core", ...(await readdir(join(workspace, "packages")))];

  await mkdir(target, { recursive: true });

  // The framework packages themselves, as a workspace install links them: the
  // config bundle keeps `@warlock.js/*` imports external.
  await mkdir(join(target, "@warlock.js"), { recursive: true });

  for (const name of await readdir(join(workspace, "packages"))) {
    if (name === "create-warlock") continue;

    await symlink(join(workspace, "packages", name), join(target, "@warlock.js", name), "dir").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
  }

  const link = async (from: string, to: string) => {
    await symlink(from, to, "dir").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  };

  for (const owner of owners) {
    const modules = join(workspace, "packages", owner, "node_modules");
    const entries = await readdir(modules).catch(() => [] as string[]);

    for (const entry of entries) {
      if (entry === ".bin" || entry.startsWith(".")) continue;

      if (!entry.startsWith("@")) {
        await link(join(modules, entry), join(target, entry));

        continue;
      }

      await mkdir(join(target, entry), { recursive: true });

      for (const child of await readdir(join(modules, entry))) {
        await link(join(modules, entry, child), join(target, entry, child));
      }
    }
  }
}

/**
 * Write a two-site Warlock Web app (`landing` and `client`), each with a root
 * page that references the named route `ping.show`, into `directory`.
 *
 * Uses the framework's own sources through `tsconfig` paths and Vite aliases,
 * the way the framework's other web integration tests do, and links the web
 * package's dependencies. It also writes a Vitest layout with the HTTP test
 * server (web connector included) in its global setup.
 */
export async function writeTwoSiteApp(directory: string): Promise<void> {
  const paths: Record<string, string[]> = {};
  const aliases: { find: string; replacement: string }[] = [];

  for (const name of await readdir(join(workspace, "packages"))) {
    if (name === "create-warlock") continue;

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

  await write("package.json", JSON.stringify({ name: "two-site-fixture", type: "module" }));
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
export default defineConfig({devServer:{generateTypings:false,healthCheckers:false,checkForUpdates:false},connectors:[webConnector({webRoot:${JSON.stringify(join(workspace, "packages/web"))},resolveAlias:${JSON.stringify(aliases)},plugins:[{name:"owned-cache",config:()=>({cacheDir:process.cwd()+"/.warlock/node_modules/.vite", optimizeDeps:{include:["devalue","@mongez/localization","@mongez/react-form"]}})}]})]});`,
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
  await write(
    "src/config/web.ts",
    `export default {sites:${JSON.stringify(
      Object.fromEntries(
        Object.entries(SITE_HOSTS).map(([site, host]) => [site, { hosts: [host] }]),
      ),
    )}};`,
  );
  await write(
    "src/app/ping/routes.ts",
    `import {router} from '@warlock.js/core';
router.get('/api/ping', ({response}) => response.success({ok:true}), {name:'${NAMED_ROUTE}'});`,
  );

  for (const site of Object.keys(SITE_HOSTS)) {
    await write(`src/web/$sites/${site}/root.tsx`, "export {};");
    await write(`src/web/$sites/${site}/index.page.tsx`, page(site));
  }

  // The Vitest layout `warlock add test` generates, with the HTTP test server
  // (web connector included) started once in the global setup.
  const packages = join(workspace, "packages");
  const source = (name: string) => join(packages, name, "src/index.ts");

  const aliasLines = ["seal", "cascade", "context", "logger", "cache", "fs", "herald", "web"]
    .map(
      (name) =>
        `    { find: /^@warlock\\.js\\/${name}$/, replacement: ${JSON.stringify(source(name))} },`,
    )
    .join("\n");

  await write(
    "vitest.config.ts",
    `import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: [
    { find: "@warlock.js/web/client/runtime", replacement: ${JSON.stringify(join(packages, "web/src/client/runtime/index.ts"))} },
    { find: /^@warlock\\.js\\/core\\/tests$/, replacement: ${JSON.stringify(join(packages, "core/src/tests/index.ts"))} },
    { find: /^@warlock\\.js\\/core$/, replacement: ${JSON.stringify(source("core"))} },
${aliasLines}
  ] },
  server: { fs: { allow: [${JSON.stringify(workspace)}] } },
  test: {
    env: { NODE_ENV: "test" },
    environment: "node",
    pool: "forks",
    runner: "./src/test-runner.ts",
    globalSetup: "./src/test-global-setup.ts",
    setupFiles: ["./src/test-setup.ts"],
    include: ["tests/**/*.test.ts"],
    testTimeout: 60000,
  },
});
`,
  );
  await write(
    "src/test-global-setup.ts",
    `import { startHttpTestServer, stopHttpTestServer } from "@warlock.js/core/tests";
export async function setup() { await startHttpTestServer({ port: 0 }); }
export async function teardown() { await stopHttpTestServer(); }
`,
  );
  await write(
    "src/test-runner.ts",
    `import { configureTestWorker } from "@warlock.js/core/tests";
import { TestRunner } from "vitest";
export default class WarlockTestRunner extends TestRunner {
  public constructor(config: ConstructorParameters<typeof TestRunner>[0]) {
    super(config);
    configureTestWorker({ pool: this.pool, watch: config.watch, isolate: config.isolate }, (cleanup) => this.onCleanupWorkerContext?.(cleanup));
  }
}
`,
  );
  await write(
    "src/test-setup.ts",
    `import { setupTest, teardownTest } from "@warlock.js/core/tests";
import { afterAll, expect } from "vitest";
await setupTest({ importModule: (file) => import(file), file: expect.getState().testPath });
afterAll(teardownTest);
`,
  );
  await write(
    "tests/sites.test.ts",
    `import { request } from "node:http";
import { expect, it } from "vitest";
import { getTestServerUrl } from "@warlock.js/core/tests";

// \`fetch\` does not promise to send a custom Host header, so the request goes
// through node:http, which does.
function get(host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(getTestServerUrl());
    const outgoing = request(
      { host: target.hostname, port: target.port, path: "/", method: "GET", headers: { host, accept: "text/html" } },
      (incoming) => {
        let body = "";

        incoming.setEncoding("utf8");
        incoming.on("data", (chunk) => (body += chunk));
        incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body }));
      },
    );

    outgoing.on("error", reject);
    outgoing.end();
  });
}

it.each(${JSON.stringify(Object.entries(SITE_HOSTS))})("renders the %s site's root page under the HTTP test server", async (site, host) => {
  const response = await get(host);

  expect(response.status, response.body.slice(0, 2000)).toBe(200);
  expect(response.body).toContain(site + " home");
  expect(response.body).toContain("${NAMED_ROUTE}");
});
`,
  );
}
