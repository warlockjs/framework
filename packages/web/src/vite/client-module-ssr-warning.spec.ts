import { describe, expect, it } from "vitest";
import {
  clientModuleSsrWarning,
  clientModuleSsrWarningPlugin,
  topLevelBrowserGlobals,
} from "./client-module-ssr-warning";

const ID = "/app/src/app/users/format.client.ts";

describe("topLevelBrowserGlobals", () => {
  it("reports a browser global read while the module is evaluated, with its line", () => {
    const found = topLevelBrowserGlobals(`export const width = window.innerWidth;\n`, ID);

    expect(found).toEqual([{ name: "window", line: 1 }]);
  });

  it("reports nothing for reads inside functions and methods", () => {
    const code = [
      `export function width() { return window.innerWidth; }`,
      `export const title = () => document.title;`,
      `export class Store { read() { return localStorage.getItem("a"); } }`,
    ].join("\n");

    expect(topLevelBrowserGlobals(code, ID)).toEqual([]);
  });

  it("reports nothing for typeof tests and for code guarded by one", () => {
    const code = [
      `export const hasWindow = typeof window !== "undefined";`,
      `export const width = typeof window !== "undefined" ? window.innerWidth : 0;`,
      `if (typeof document !== "undefined") { document.title = "x"; }`,
      `export const saved = typeof localStorage !== "undefined" && localStorage.getItem("a");`,
    ].join("\n");

    expect(topLevelBrowserGlobals(code, ID)).toEqual([]);
  });

  it("does not mistake a property or object key named like a global", () => {
    const code = `export const config = { window: 1 };\nexport const value = config.window;\n`;

    expect(topLevelBrowserGlobals(code, ID)).toEqual([]);
  });

  it("returns nothing for source it cannot parse", () => {
    expect(topLevelBrowserGlobals("export const = ;", ID)).toEqual([]);
  });
});

describe("clientModuleSsrWarning", () => {
  it("names the module, the line, the global and the fix", () => {
    const message = clientModuleSsrWarning(`\nexport const ua = navigator.userAgent;\n`, ID);

    expect(message).toContain("`navigator`");
    expect(message).toContain("/app/src/app/users/format.client.ts:2");
    expect(message).toContain("<ClientOnly>");
  });

  it("is silent for a clean module", () => {
    expect(clientModuleSsrWarning(`export const answer = 42;\n`, ID)).toBeUndefined();
  });
});

describe("clientModuleSsrWarningPlugin", () => {
  function transformWith(code: string, id: string, ssr: boolean) {
    const warnings: string[] = [];
    const plugin = clientModuleSsrWarningPlugin();
    const transform = plugin.transform as (
      this: { warn(message: string): void },
      code: string,
      id: string,
      options?: { ssr?: boolean },
    ) => unknown;

    transform.call({ warn: (message) => warnings.push(message) }, code, id, { ssr });

    return warnings;
  }

  it("warns for a .client module evaluated on the server", () => {
    expect(transformWith(`window.x = 1;\n`, ID, true)).toHaveLength(1);
  });

  it("does not warn in the client environment or for an ordinary module", () => {
    expect(transformWith(`window.x = 1;\n`, ID, false)).toEqual([]);
    expect(transformWith(`window.x = 1;\n`, "/app/src/app/users/format.ts", true)).toEqual([]);
  });

  it("warns once per module", () => {
    const plugin = clientModuleSsrWarningPlugin();
    const warnings: string[] = [];
    const transform = plugin.transform as (
      this: { warn(message: string): void },
      code: string,
      id: string,
      options?: { ssr?: boolean },
    ) => unknown;
    const context = { warn: (message: string) => warnings.push(message) };

    transform.call(context, `window.x = 1;\n`, ID, { ssr: true });
    transform.call(context, `window.x = 1;\n`, ID, { ssr: true });

    expect(warnings).toHaveLength(1);
  });
});
