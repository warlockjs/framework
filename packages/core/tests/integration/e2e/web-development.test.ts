import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { runE2E } from "../../../src/e2e";

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const field = `import { useId } from 'react';
import {useForm} from '@mongez/react-form';
export function Field() { const id = useId(); const form=useForm(); return <div><label htmlFor={id}>Name</label><input id={id} aria-describedby={id+'-hint'} onClick={event => {event.currentTarget.dataset.hookId=id;event.currentTarget.dataset.formHookId=form?.id ?? ''}}/><span id={id+'-hint'}>Name hint</span></div> }
`;
const page = (revision: number) => `import { Field } from './field';
import { Link } from '@warlock.js/web';
import { Form } from '@mongez/react-form';
export default function Page({data}) { return <><h1>Revision ${revision}</h1><p id="theme">{data.theme}</p><Form><Field/><Field/></Form><Form><Field/></Form><Link to="/away">Away</Link></> }
`;

it.each(["shared", "identifiers"])(
  "development regression: %s",
  async (scenario) => {
    const source = await mkdtemp(join(tmpdir(), "warlock-web-development-"));
    const outputDirectory = join(workspace, ".warlock/e2e/web-development", scenario);
    const pageSource = (revision: number) =>
      scenario === "identifiers"
        ? page(revision)
        : page(revision).replace(
            "import { Form } from '@mongez/react-form';",
            "const Form = 'form';",
          );
    try {
      await symlink(
        join(workspace, "packages/web/node_modules"),
        join(source, "node_modules"),
        "dir",
      );
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
      await writeFile(
        join(source, "package.json"),
        JSON.stringify({ name: "web-development-fixture", type: "module" }),
      );
      await writeFile(
        join(source, "tsconfig.json"),
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
      await writeFile(
        join(source, "warlock.config.ts"),
        `import {defineConfig} from '@warlock.js/core';
import {webConnector} from '@warlock.js/web/connector';
export default defineConfig({devServer:{generateTypings:false,healthCheckers:false,checkForUpdates:false},connectors:[webConnector({webRoot:${JSON.stringify(join(workspace, "packages/web"))},resolveAlias:${JSON.stringify(aliases)},plugins:[{name:"owned-cache",config:()=>({cacheDir:process.cwd()+"/.warlock/node_modules/.vite", optimizeDeps:{include:["devalue","@mongez/localization","@mongez/react-form"]}})}]})]});`,
      );
      await mkdir(join(source, "public"), { recursive: true });
      await writeFile(
        join(source, "public/favicon.ico"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      await mkdir(join(source, "src/config"), { recursive: true });
      await mkdir(join(source, "src/web"), { recursive: true });
      await writeFile(
        join(source, "src/config/http.ts"),
        `export default {port:Number(process.env.HTTP_PORT),host:'127.0.0.1',log:false};`,
      );
      await writeFile(
        join(source, "src/config/app.ts"),
        `export default {localeCode:'en',localeCodes:['en'],baseUrl:'http://127.0.0.1:'+process.env.HTTP_PORT};`,
      );
      await writeFile(
        join(source, "src/web/field.tsx"),
        scenario === "identifiers"
          ? field
          : `import {useState} from 'react';export function Field(){const [count,setCount]=useState(0);return <button type="button" onClick={()=>setCount(count+1)}>Count {count}</button>}`,
      );
      await writeFile(
        join(source, "src/web/layout.tsx"),
        `import {Field} from './field'; export default function Layout({children,data}) {return <main><p id="layout-revision">{data?.marker ?? "none"}</p><Field/>{children}</main>}`,
      );
      await writeFile(join(source, "src/web/root.tsx"), "export {};");
      await writeFile(
        join(source, "src/web/root.setup.ts"),
        `import {shared} from '@warlock.js/web'; export const config={middleware:[async ({request})=>{shared.theme=request.input('theme','light')}]};`,
      );
      await writeFile(
        join(source, "src/web/index.setup.ts"),
        `import {shared} from '@warlock.js/web'; export const config={route:{path:'/',name:'home'}}; export const loader=async()=>{await new Promise(resolve=>setTimeout(resolve,10));return {theme:shared.theme}};`,
      );
      await writeFile(join(source, "src/web/index.page.tsx"), pageSource(0));
      await writeFile(
        join(source, "src/web/away.setup.ts"),
        `export const config={route:{path:'/away',name:'away'}};`,
      );
      await writeFile(
        join(source, "src/web/away.page.tsx"),
        `import {Link} from '@warlock.js/web';export default function Away(){return <><h1>Away</h1><Link to="/">Home</Link></>}`,
      );
      const result = await runE2E(
        {
          app: {
            directory: source,
            start: [process.execPath, join(workspace, "packages/core/bin/warlock.js"), "dev"],
            env: { NODE_ENV: "development", WARLOCK_DEV_WORKER: "1" },
            startupTimeoutMs: 180_000,
          },
          browser: {
            args: process.getuid?.() === 0 ? ["--no-sandbox"] : [],
            startupTimeoutMs: 60_000,
          },
          run: async ({ page: browserPage, directory, url, step }) => {
            await browserPage.goto("/");
            for (let revision = 0; revision < 5; revision++) {
              await step(`watched revision ${revision}`, async () => {
                if (revision === 1 || revision === 2)
                  await writeFile(
                    join(directory, "src/web/layout.setup.ts"),
                    `import {shared} from '@warlock.js/web'; export const loader=()=>({marker:'${revision}',theme:shared.theme});`,
                  );
                if (revision === 3) await rm(join(directory, "src/web/layout.setup.ts"));
                const marker = revision === 1 || revision === 2 ? String(revision) : "none";
                await expect
                  .poll(async () => (await fetch(url)).text(), { timeout: 30_000 })
                  .toContain(`<p id="layout-revision">${marker}</p>`);
                await browserPage.waitFor({ selector: "#layout-revision", text: marker });
                await browserPage.waitForNetworkIdle();
                if (revision > 0) {
                  await writeFile(join(directory, "src/web/index.page.tsx"), pageSource(revision));
                  await browserPage.waitFor({ selector: "h1", text: `Revision ${revision}` });
                  await browserPage.waitForNetworkIdle();
                }
                await expect
                  .poll(async () => (await fetch(url)).text(), { timeout: 30_000 })
                  .toContain(`Revision ${revision}`);
                const serverHtml = await (await fetch(url)).text();
                const serverIds = [...serverHtml.matchAll(/<input[^>]* id="([^"]+)"/g)].map(
                  (match) => match[1],
                );
                await browserPage.goto("/");
                await browserPage.waitFor({ selector: "h1", text: `Revision ${revision}` });
                expect(
                  await browserPage.evaluate("document.querySelector('#theme').textContent"),
                ).toBe("light");
                const concurrent = await Promise.all(
                  ["light", "dark"].map(async (theme) => {
                    const response = await fetch(url + "?theme=" + theme);
                    expect(response.status).toBe(200);
                    expect(await response.text()).toContain(`<p id="theme">${theme}</p>`);
                  }),
                );
                expect(concurrent).toHaveLength(2);
                if (scenario === "shared") {
                  const count = await browserPage.evaluate<number>(
                    "Number(document.querySelector('button').textContent.split(' ')[1])",
                  );
                  await browserPage.click("button");
                  await browserPage.waitFor({ selector: "button", text: `Count ${count + 1}` });
                }
                const inputs = await browserPage.evaluate<string[]>(
                  "Array.from(document.querySelectorAll('input'), input=>input.id)",
                );
                expect(inputs).toEqual(serverIds);
                expect(new Set(inputs).size).toBe(inputs.length);
                const formIds = await browserPage.evaluate<string[]>(
                  "Array.from(document.querySelectorAll('form'),form=>form.id)",
                );
                if (scenario === "identifiers") {
                  expect(inputs).toHaveLength(4);
                  expect(formIds).toHaveLength(2);
                  expect(new Set(formIds).size).toBe(2);
                }
                for (const id of inputs) {
                  await browserPage.click(`input[id="${id}"]`);
                  expect(
                    await browserPage.evaluate(
                      `document.getElementById(${JSON.stringify(id)}).dataset.hookId`,
                    ),
                  ).toBe(id);
                  expect(
                    await browserPage.evaluate(
                      `(() => { const input=document.getElementById(${JSON.stringify(id)});return !input.form || input.dataset.formHookId === input.form.id;})()`,
                    ),
                  ).toBe(true);
                }
                expect(
                  await browserPage.evaluate(
                    "Array.from(document.querySelectorAll('input')).every(input=>document.querySelector('label[for=\"'+input.id+'\"]') && document.getElementById(input.getAttribute('aria-describedby')))",
                  ),
                ).toBe(true);
                await browserPage.waitForNetworkIdle();
                await browserPage.captureViewports(`revision-${revision}`);
              });
            }
            await browserPage.waitForNavigation(() => browserPage.click('a[href="/away"]'), {
              url: "/away",
            });
            await browserPage.waitForNavigation(() => browserPage.click('a[href="/"]'), {
              url: "/",
            });
            await browserPage.waitFor({ selector: "h1", text: "Revision 4" });
            for (const id of await browserPage.evaluate<string[]>(
              "Array.from(document.querySelectorAll('input'),input=>input.id)",
            )) {
              await browserPage.click(`input[id="${id}"]`);
              expect(
                await browserPage.evaluate(
                  `document.getElementById(${JSON.stringify(id)}).dataset.hookId`,
                ),
              ).toBe(id);
            }
          },
        },
        { outputDirectory },
      );
      expect(result.evidence.processes.every((process) => process.stopped)).toBe(true);
      console.info(`Browser evidence: ${result.evidenceFile}`);
    } finally {
      await rm(source, { recursive: true, force: true });
    }
  },
  300_000,
);
