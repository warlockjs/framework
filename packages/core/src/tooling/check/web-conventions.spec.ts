import { describe, expect, it } from "vitest";
import { checkFileConventions } from "./conventions-step";

const file = "src/web/pages/example.tsx";
const codes = (source: string, name = file) =>
  checkFileConventions(name, source, "/tmp").map((problem) => problem.code);

describe("web convention fixtures", () => {
  it("accepts a small single component using a hook and design-system controls", () => {
    expect(
      codes(
        "export function Page() { const { save } = usePage(); return <TextInput onChange={save} />; }",
      ),
    ).toEqual([]);
  });
  it("reports the configurable file line limit", () => {
    const source = "// comment\n".repeat(149) + "export const Page = () => <div />;\n";
    expect(codes(source)).toEqual([]);
    const long = "// comment\n" + source;
    expect(codes(long)).toContain("WL9013");
    expect(checkFileConventions(file, long, "/tmp", { componentLineLimit: 300 })).toEqual([]);
  });
  it("reports a second component but allows helpers", () => {
    expect(codes("const A = () => <div/>; const B = () => <span/>;")).toContain("WL9014");
    expect(codes("const A = () => <div/>; const helper = () => 1;")).toEqual([]);
  });
  it.each(["useState", "useReducer", "useEffect", "useLayoutEffect"])(
    "moves %s to a hook",
    (hook) => {
      expect(codes(`function Page() { ${hook}(() => {}); return <div/>; }`)).toContain("WL9015");
    },
  );
  it.each(["<button onClick={() => save()} />", "<button onClick={save} />"])(
    "reports inline handlers %s",
    (jsx) => {
      expect(codes(`function Page() { const save = () => {}; return ${jsx}; }`)).toContain(
        "WL9015",
      );
    },
  );
  it("recognizes local function declarations used as handlers", () => {
    expect(
      codes("function Page() { function save() {} return <button onClick={save}/>; }"),
    ).toContain("WL9015");
  });
  it("accepts state in a hook file and handlers returned by hooks", () => {
    expect(
      codes("export function usePage() { return useState(0); }", "src/web/hooks/use-page.ts"),
    ).toEqual([]);
    expect(
      codes("function Page() { const { save } = usePage(); return <button onClick={save}/>; }"),
    ).toEqual([]);
  });
  it("recognizes aliased React hooks", () => {
    expect(
      codes(
        'import { useState as state } from "react"; const Page = () => { state(0); return <div/>; };',
      ),
    ).toContain("WL9015");
  });
  it.each([
    "<select/>",
    ...["checkbox", "radio", "date", "time", "datetime-local"].map(
      (type) => `<input type="${type}"/>`,
    ),
  ])("reports native control %s", (jsx) => {
    expect(codes(`const Page = () => ${jsx};`)).toContain("WL9016");
    expect(
      codes(`const Control = () => ${jsx};`, "src/web/design-system/control.tsx"),
    ).not.toContain("WL9016");
  });
  it.each([
    "required",
    'pattern=".*"',
    'min="1"',
    'max="5"',
    "minLength={2}",
    "maxLength={5}",
    'type="email"',
  ])("reports validation %s", (attribute) => {
    expect(codes(`const Page = () => <input ${attribute}/>;`)).toContain("WL9017");
    expect(codes(`const Page = () => <TextInput ${attribute}/>;`)).not.toContain("WL9017");
  });
  it("accepts ordinary native inputs and reports textarea/select validation", () => {
    expect(codes('const Page = () => <input type="text"/>;')).toEqual([]);
    expect(codes("const Page = () => <textarea required/>;")).toContain("WL9017");
    expect(codes("const Page = () => <select required/>;")).toContain("WL9017");
  });
  it("supports suppression and per-project severity", () => {
    const source = "const Page = () => <select/>;";
    expect(codes("// warlock-check-ignore WL9016\n" + source)).toEqual([]);
    expect(checkFileConventions(file, source, "/tmp", { rules: { WL9016: "off" } })).toEqual([]);
    expect(
      checkFileConventions(file, source, "/tmp", { rules: { WL9016: "error" } })[0]?.severity,
    ).toBe("error");
  });
});

describe("controller response contracts", () => {
  const controller = "src/app/posts/controllers/list.ts";
  const handler = "export const list: RequestHandler = () => {};";
  it("reports an exported handler without a response schema", () => {
    expect(codes(handler, controller)).toContain("WL9018");
  });
  it("accepts static schemas, ignores helpers and files outside controllers", () => {
    expect(codes(handler + "list.responseSchema = { 200: schema };", controller)).toEqual([]);
    expect(codes("const helper: RequestHandler = () => {};", controller)).toEqual([]);
    expect(codes(handler, "src/app/posts/services/list.ts")).toEqual([]);
  });
  it("accepts Object.assign contracts and aliased handler annotations", () => {
    expect(
      codes(
        "export const list: RequestHandler = Object.assign(() => {}, { responseSchema: { 200: schema } });",
        controller,
      ),
    ).toEqual([]);
    expect(
      codes(
        'import type { RequestHandler as Handler } from "@warlock.js/core"; export const list: Handler = () => {};',
        controller,
      ),
    ).toContain("WL9018");
  });
  it("recognizes separate exports and satisfies annotations", () => {
    expect(
      codes("const list = (() => {}) satisfies RequestHandler; export { list };", controller),
    ).toContain("WL9018");
  });
});
