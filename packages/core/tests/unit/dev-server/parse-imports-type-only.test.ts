import { describe, expect, it } from "vitest";
import { isTypeOnlyFile } from "../../../src/dev-server/parse-imports";

/**
 * `isTypeOnlyFile` decides whether a source file emits any runtime code. The
 * dependency graph relies on it to drop edges TypeScript erases. Only the
 * pure string heuristic is exercised here — no filesystem, no tsconfig.
 */
describe("isTypeOnlyFile — type-only sources", () => {
  it("treats a lone interface export as type-only", () => {
    expect(isTypeOnlyFile("export interface User { id: number }")).toBe(true);
  });

  it("treats a type alias export as type-only", () => {
    expect(isTypeOnlyFile("export type Id = string | number;")).toBe(true);
  });

  it("treats `export type { X }` re-exports as type-only", () => {
    expect(isTypeOnlyFile(`export type { User } from "./user";`)).toBe(true);
  });

  it("treats `export type { X, Y }` multi-specifier re-exports as type-only", () => {
    expect(isTypeOnlyFile(`export type { User, Role } from "./models";`)).toBe(true);
  });

  it("ignores type exports buried inside comments and strings", () => {
    const source = [
      "// export const fake = 1;",
      "/* export function alsoFake() {} */",
      `const note = "export class NotReal {}";`,
      "export interface Real { ok: boolean }",
    ].join("\n");

    expect(isTypeOnlyFile(source)).toBe(true);
  });
});

describe("isTypeOnlyFile — runtime sources", () => {
  it("flags `export const` as runtime", () => {
    expect(isTypeOnlyFile("export const x = 1;")).toBe(false);
  });

  it("flags `export function` as runtime", () => {
    expect(isTypeOnlyFile("export function run() {}")).toBe(false);
  });

  it("flags `export async function` as runtime", () => {
    expect(isTypeOnlyFile("export async function run() {}")).toBe(false);
  });

  it("flags `export class` as runtime", () => {
    expect(isTypeOnlyFile("export class Service {}")).toBe(false);
  });

  it("flags `export enum` as runtime (enums emit a value)", () => {
    expect(isTypeOnlyFile("export enum Color { Red, Green }")).toBe(false);
  });

  it("flags `export default` (non-type) as runtime", () => {
    expect(isTypeOnlyFile("export default function () {}")).toBe(false);
  });

  it("flags `export * from` as runtime (re-exports everything)", () => {
    expect(isTypeOnlyFile(`export * from "./service";`)).toBe(false);
  });

  it("flags a mixed specifier list with one runtime member as runtime", () => {
    const source = `export { type User, createUser } from "./user";`;

    expect(isTypeOnlyFile(source)).toBe(false);
  });

  it("flags an inline-`type` re-export list as runtime (only `export type {` is recognised)", () => {
    // The heuristic detects type-only re-exports via the `export type { ... }`
    // form; an `export { type X } from` list is classified runtime here.
    const source = `export { type User, type Role } from "./models";`;

    expect(isTypeOnlyFile(source)).toBe(false);
  });

  it("flags a bare local re-export without the type keyword as runtime", () => {
    const source = `const value = 1;\nexport { value };`;

    expect(isTypeOnlyFile(source)).toBe(false);
  });
});

describe("isTypeOnlyFile — neither", () => {
  it("does not consider an imports-only file type-only (no type exports)", () => {
    const source = `import { something } from "./service";`;

    expect(isTypeOnlyFile(source)).toBe(false);
  });

  it("does not consider an empty file type-only", () => {
    expect(isTypeOnlyFile("")).toBe(false);
  });
});
